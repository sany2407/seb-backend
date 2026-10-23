-- Shared EB Bill schema — run in Supabase SQL editor.
-- Backend uses the service_role key (bypasses RLS). No public policies:
-- nothing is readable from the browser directly.

create extension if not exists "pgcrypto";

-- auto updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============ homes ============
create table homes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occupant text not null default '',
  meter_no text not null unique,
  meter_type text not null default 'SUB' check (meter_type in ('MAIN','SUB')),
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger homes_updated_at before update on homes
  for each row execute function set_updated_at();

-- ============ meters ============
create table meters (
  id uuid primary key default gen_random_uuid(),
  home_id uuid references homes(id) on delete set null,
  meter_no text not null unique,
  type text not null check (type in ('MAIN','SUB')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger meters_updated_at before update on meters
  for each row execute function set_updated_at();
create index meters_home_idx on meters(home_id);

-- ============ meter_readings ============
create table meter_readings (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references meters(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  month_key text not null check (month_key ~ '^\d{4}-\d{2}$'),
  month text not null,
  prev numeric not null check (prev >= 0),
  curr numeric not null check (curr >= 0),
  units numeric not null,
  meter_reset boolean not null default false,
  photo_count int not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meter_id, month_key),
  check (meter_reset or curr >= prev)
);
create trigger meter_readings_updated_at before update on meter_readings
  for each row execute function set_updated_at();
create index meter_readings_month_idx on meter_readings(month_key);
create index meter_readings_home_idx on meter_readings(home_id);

-- ============ eb_bills ============
create table eb_bills (
  id uuid primary key default gen_random_uuid(),
  month_key text not null unique check (month_key ~ '^\d{4}-\d{2}$'),
  month text not null,
  bill_no text not null,
  main_prev numeric not null check (main_prev >= 0),
  main_curr numeric not null check (main_curr >= 0),
  main_units numeric not null,
  amount numeric(10,2) not null check (amount > 0),
  bill_date date,
  due_date date,
  status text not null default 'Pending' check (status in ('Pending','Paid','Partial','Overdue')),
  paid numeric(10,2) not null default 0,
  method text not null default 'usage' check (method in ('usage','equal','percentage')),
  common_units numeric not null default 0,
  common_amount numeric(10,2) not null default 0,
  payment_method text,
  payment_date date,
  notes text not null default '',
  attachment_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (main_curr >= main_prev)
);
create trigger eb_bills_updated_at before update on eb_bills
  for each row execute function set_updated_at();

-- ============ bill_splits ============
create table bill_splits (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references eb_bills(id) on delete cascade,
  home_id uuid references homes(id) on delete set null, -- NULL = COMMON row
  home_name text not null,
  units numeric not null default 0,
  percent numeric not null default 0,
  amount numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create index bill_splits_bill_idx on bill_splits(bill_id);

-- ============ payments ============
create table payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references eb_bills(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  paid_at date not null default current_date,
  method text,
  ref text,
  screenshot_url text,
  created_at timestamptz not null default now()
);
create index payments_bill_idx on payments(bill_id);

-- ============ attachments (metadata only; bytes live in Cloudinary) ============
create table attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('EB_BILL','METER_READING','PAYMENT')),
  owner_id uuid not null,
  file_name text not null,
  file_url text not null,
  file_type text not null,
  file_size bigint not null default 0,
  attachment_type text not null check (attachment_type in ('EB_BILL','METER_PHOTO','PAYMENT_RECEIPT','PAYMENT_SCREENSHOT','OTHER')),
  uploaded_at timestamptz not null default now()
);
create index attachments_owner_idx on attachments(owner_type, owner_id);

-- ============ lock down (service_role bypasses RLS) ============
alter table homes enable row level security;
alter table meters enable row level security;
alter table meter_readings enable row level security;
alter table eb_bills enable row level security;
alter table bill_splits enable row level security;
alter table payments enable row level security;
alter table attachments enable row level security;

-- ============ seed: main meter + 3 homes ============
insert into homes (name, occupant, meter_no, meter_type, notes) values
  ('Main Meter', 'TANGEDCO', 'MAIN-TNEB-01', 'MAIN', 'Actual EB meter'),
  ('Home A', 'Sany', 'MTR001', 'SUB', 'Ground floor'),
  ('Home B', 'Kumar', 'MTR002', 'SUB', 'First floor'),
  ('Home C', 'Priya', 'MTR003', 'SUB', 'Second floor');

insert into meters (home_id, meter_no, type)
select id, meter_no, meter_type from homes;
