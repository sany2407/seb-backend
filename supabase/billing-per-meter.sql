-- Billing config moves onto the MAIN meter (one config per main unit, not per bill).
-- Run in the Supabase SQL editor AFTER billing.sql.

alter table meters
  add column billing_interval_months int not null default 1
    check (billing_interval_months in (1, 2, 3, 6, 12));
alter table meters
  add column unit_price numeric(10,4) not null default 0
    check (unit_price >= 0);

-- Carry over values users already saved in the global settings row:
update meters m
set billing_interval_months = s.billing_interval_months,
    unit_price = s.unit_price
from settings s
where m.owner_id = s.user_id and m.type = 'MAIN';
