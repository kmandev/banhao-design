-- BANHAO — push_tokens (20261108000002). Fixture ids use the 4b prefix block.
--   A. No grant to anon/authenticated.
--   B. Token shape, platform and app CHECKs.
--   C. A token is unique across users.
--   D. Deleting the profile removes its tokens.

\set ON_ERROR_STOP on

create or replace function pt_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then raise notice 'PASS  %', label; else raise exception 'FAIL  %', label; end if;
end;
$$;

create or replace function pt_sqlstate(stmt text)
returns text language plpgsql as $$
begin execute stmt; return 'OK'; exception when others then return sqlstate; end;
$$;

create or replace function pt_call_as(role_name text, stmt text)
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

insert into auth.users (id, phone) values ('4b000000-0000-4000-8000-000000000001', '+66892290071') on conflict (id) do nothing;
insert into auth.users (id, phone) values ('4b000000-0000-4000-8000-000000000002', '+66892290072') on conflict (id) do nothing;

select pt_assert(pt_call_as('anon', 'select * from public.push_tokens') = 'BLOCKED', 'A1 anon cannot read');
select pt_assert(pt_call_as('authenticated', 'select * from public.push_tokens') = 'BLOCKED', 'A2 authenticated cannot read');

select pt_assert(pt_sqlstate($$insert into public.push_tokens (user_id, token, platform, app) values ('4b000000-0000-4000-8000-000000000001', 'not-a-token', 'ios', 'customer')$$) = '23514', 'B1 malformed token refused');
select pt_assert(pt_sqlstate($$insert into public.push_tokens (user_id, token, platform, app) values ('4b000000-0000-4000-8000-000000000001', 'ExponentPushToken[abc]', 'web', 'customer')$$) = '23514', 'B2 unknown platform refused');
select pt_assert(pt_sqlstate($$insert into public.push_tokens (user_id, token, platform, app) values ('4b000000-0000-4000-8000-000000000001', 'ExponentPushToken[abc]', 'ios', 'merchant')$$) = '23514', 'B3 unknown app refused');
select pt_assert(pt_sqlstate($$insert into public.push_tokens (user_id, token, platform, app) values ('4b000000-0000-4000-8000-000000000001', 'ExponentPushToken[abc]', 'ios', 'customer')$$) = 'OK', 'B4 a valid token inserts');

select pt_assert(pt_sqlstate($$insert into public.push_tokens (user_id, token, platform, app) values ('4b000000-0000-4000-8000-000000000002', 'ExponentPushToken[abc]', 'android', 'driver')$$) = '23505', 'C1 the same token cannot exist twice');

delete from auth.users where id = '4b000000-0000-4000-8000-000000000001';
select pt_assert(not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[abc]'), 'D1 deleting the user removes its tokens');

rollback;

select 'push_tokens assertions complete' as assertions;
