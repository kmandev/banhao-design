-- BANHAO — DEC-071 delivery_fee_settings (20261108000001)
-- Run by run-domain-tests.sh. Fixture ids use the 4a prefix block.
--
--   A. No grant to anon/authenticated (read or write).
--   B. The seed row is FIXED 1500.
--   C. Shape CHECKs: FIXED outside ฿15–35 refused; PERCENT with a fixed
--      amount, out-of-range bp, out-of-band min/max, or min > max refused;
--      blank reason refused.
--   D. Valid FIXED and PERCENT rows insert, and the newest row wins.
--   E. Append-only: UPDATE and DELETE are refused.

\set ON_ERROR_STOP on

create or replace function dfs_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then raise notice 'PASS  %', label; else raise exception 'FAIL  %', label; end if;
end;
$$;

create or replace function dfs_sqlstate(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

create or replace function dfs_call_as(role_name text, stmt text)
returns text language plpgsql as $$
declare err text;
begin
  perform set_config('role', role_name, true);
  begin execute stmt; err := 'ALLOWED'; exception when others then err := 'BLOCKED'; end;
  perform set_config('role', 'postgres', true);
  return err;
end;
$$;

begin;

-- A
select dfs_assert(dfs_call_as('anon', 'select * from public.delivery_fee_settings') = 'BLOCKED', 'A1 anon cannot read');
select dfs_assert(dfs_call_as('authenticated', 'select * from public.delivery_fee_settings') = 'BLOCKED', 'A2 authenticated cannot read');
select dfs_assert(dfs_call_as('authenticated',
  $$insert into public.delivery_fee_settings (mode, fixed_satang, reason) values ('FIXED', 2000, 'x')$$) = 'BLOCKED',
  'A3 authenticated cannot insert');

-- B
select dfs_assert(
  (select mode = 'FIXED' and fixed_satang = 1500 from public.delivery_fee_settings order by created_at asc limit 1),
  'B1 seed row is FIXED 1500');

-- C
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, reason) values ('FIXED', 1499, 'r')$$) = '23514', 'C1 FIXED below ฿15 refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, reason) values ('FIXED', 3501, 'r')$$) = '23514', 'C2 FIXED above ฿35 refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, percent_basis_points, reason) values ('FIXED', 2000, 500, 'r')$$) = '23514', 'C3 FIXED carrying a percentage refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, percent_basis_points, reason) values ('PERCENT', 2000, 500, 'r')$$) = '23514', 'C4 PERCENT carrying a fixed amount refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, percent_basis_points, reason) values ('PERCENT', 0, 'r')$$) = '23514', 'C5 PERCENT of 0 refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, percent_basis_points, reason) values ('PERCENT', 10001, 'r')$$) = '23514', 'C6 PERCENT above 100% refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, percent_basis_points, min_satang, reason) values ('PERCENT', 800, 1000, 'r')$$) = '23514', 'C7 PERCENT min below ฿15 refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, percent_basis_points, max_satang, reason) values ('PERCENT', 800, 4000, 'r')$$) = '23514', 'C8 PERCENT max above ฿35 refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, percent_basis_points, min_satang, max_satang, reason) values ('PERCENT', 800, 3000, 2000, 'r')$$) = '23514', 'C9 PERCENT min above max refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, reason) values ('FIXED', 2000, '   ')$$) = '23514', 'C10 blank reason refused');
select dfs_assert(dfs_sqlstate($$insert into public.delivery_fee_settings (mode, fixed_satang, reason) values ('FLAT', 2000, 'r')$$) = '23514', 'C11 unknown mode refused');

-- D
insert into public.delivery_fee_settings (id, mode, fixed_satang, reason, created_at)
  values ('4a000000-0000-4000-8000-000000000001', 'FIXED', 2000, 'test fixed', now() + interval '1 minute');
insert into public.delivery_fee_settings (id, mode, percent_basis_points, min_satang, max_satang, reason, created_at)
  values ('4a000000-0000-4000-8000-000000000002', 'PERCENT', 800, 1500, 3000, 'test percent', now() + interval '2 minutes');
select dfs_assert(
  (select id = '4a000000-0000-4000-8000-000000000002' from public.delivery_fee_settings order by created_at desc limit 1),
  'D1 newest row is the one in force');

-- E
select dfs_assert(dfs_sqlstate($$update public.delivery_fee_settings set fixed_satang = 2500 where id = '4a000000-0000-4000-8000-000000000001'$$) = '42501', 'E1 UPDATE refused');
select dfs_assert(dfs_sqlstate($$delete from public.delivery_fee_settings where id = '4a000000-0000-4000-8000-000000000001'$$) = '42501', 'E2 DELETE refused');

rollback;

select 'delivery_fee_settings assertions complete' as assertions;
