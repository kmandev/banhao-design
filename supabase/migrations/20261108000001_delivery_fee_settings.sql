-- BANHAO — DEC-070 §2 / DEC-071: the delivery fee becomes a back-office
-- setting instead of a constant in code.
--
-- One append-only table. Every change an ADMIN makes is a new row; the newest
-- row is the setting in force. Nothing updates or deletes a row, so the table
-- is its own history (who, when, why) next to the audit_logs row the API
-- writes for the same change.
--
-- Two modes:
--   FIXED   — fixed_satang.
--   PERCENT — percent_basis_points of the order's food subtotal (100 bp = 1%),
--             with optional min_satang / max_satang.
-- Whatever the mode, DEC-071 keeps every resulting fee inside 1500–3500 satang
-- (฿15–35, DEC-061 D-09/D-10). These CHECKs hold the stored values inside that
-- band so a bad row cannot exist even if the API were bypassed; the API also
-- clamps the computed fee.
--
-- Orders are unaffected by a change: each order stores its own
-- delivery_fee_satang at creation (immutable, 20260811000005).
--
-- API-only, like payments and refunds: no grant to anon or authenticated.

create table public.delivery_fee_settings (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('FIXED', 'PERCENT')),
  fixed_satang integer,
  percent_basis_points integer,
  min_satang integer,
  max_satang integer,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint delivery_fee_settings_fixed_shape check (
    mode <> 'FIXED'
    or (fixed_satang between 1500 and 3500
        and percent_basis_points is null and min_satang is null and max_satang is null)
  ),
  constraint delivery_fee_settings_percent_shape check (
    mode <> 'PERCENT'
    or (fixed_satang is null
        and percent_basis_points between 1 and 10000
        and (min_satang is null or min_satang between 1500 and 3500)
        and (max_satang is null or max_satang between 1500 and 3500)
        and (min_satang is null or max_satang is null or min_satang <= max_satang))
  )
);

comment on table public.delivery_fee_settings is
  'DEC-070 §2 / DEC-071: append-only delivery-fee setting. The newest row is in force. FIXED or PERCENT of food subtotal; every computed fee is held to 1500–3500 satang. Orders keep their own stored delivery_fee_satang. API-only.';

create index delivery_fee_settings_created_at_idx on public.delivery_fee_settings (created_at desc);

revoke all on public.delivery_fee_settings from anon, authenticated;
alter table public.delivery_fee_settings enable row level security;

create or replace function public.delivery_fee_settings_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'delivery_fee_settings is append-only: add a new row instead (DEC-071)'
    using errcode = '42501';
end;
$$;

create trigger delivery_fee_settings_no_update_delete
  before update or delete on public.delivery_fee_settings
  for each row execute function public.delivery_fee_settings_append_only();

-- The starting value (DEC-071): ฿15 fixed, the bottom of the band.
insert into public.delivery_fee_settings (mode, fixed_satang, reason)
values ('FIXED', 1500, 'Initial setting (DEC-071): fixed ฿15, the minimum of the ฿15–35 band');
