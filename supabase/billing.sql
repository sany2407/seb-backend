-- Billing preferences migration — run in the Supabase SQL editor.

-- ============ settings (one row per user) ============
create table settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  billing_interval_months int not null default 1 check (billing_interval_months in (1, 2, 3, 6, 12)),
  unit_price numeric(10,4) not null default 0 check (unit_price >= 0),
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();

-- ============ bill period + rate snapshot ============
alter table eb_bills add column period_start text check (period_start ~ '^\d{4}-\d{2}$');
alter table eb_bills add column period_end text check (period_end ~ '^\d{4}-\d{2}$');
alter table eb_bills add column unit_price numeric(10,4) not null default 0;
