-- SaaS auth migration — run AFTER supabase/schema.sql in the SQL editor.
-- Adds per-user data isolation: every tenant table carries the owner's id.

-- ============ profiles (1 row per auth user) ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ tenant owner columns ============
alter table homes           add column owner_id uuid references profiles(id) on delete cascade;
alter table meters          add column owner_id uuid references profiles(id) on delete cascade;
alter table meter_readings  add column owner_id uuid references profiles(id) on delete cascade;
alter table eb_bills        add column owner_id uuid references profiles(id) on delete cascade;
alter table payments        add column owner_id uuid references profiles(id) on delete cascade;
-- attachments keeps owner_id as the RECORD reference; tenant goes in user_id:
alter table attachments     add column user_id uuid references profiles(id) on delete cascade;

create index homes_owner_idx          on homes(owner_id);
create index meters_owner_idx         on meters(owner_id);
create index meter_readings_owner_idx on meter_readings(owner_id);
create index eb_bills_owner_idx       on eb_bills(owner_id);
create index payments_owner_idx       on payments(owner_id);
create index attachments_user_idx     on attachments(user_id);

-- Existing seed rows have NULL owner (visible to nobody via API; each user adds their own homes).
