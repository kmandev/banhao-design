-- BANHAO — LAUNCH_PLAN 1.1 / DEC-070 Q2: Expo push tokens.
--
-- One row per device token. A token belongs to whichever signed-in user last
-- registered it (a shared phone that changes hands moves its token to the new
-- user). Revoked when the user signs out, or when Expo reports the device is
-- no longer registered.
--
-- API-only: no grant to anon or authenticated. The app sends its token to
-- POST /api/v1/me/push-tokens; only the API reads tokens to send a push.

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null check (token like 'ExponentPushToken[%]' or token like 'ExpoPushToken[%]'),
  platform text not null check (platform in ('ios', 'android')),
  app text not null check (app in ('customer', 'driver')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint push_tokens_token_key unique (token)
);

comment on table public.push_tokens is
  'LAUNCH_PLAN 1.1: Expo push tokens, one per device, owned by the last user to register it. API-only. revoked_at set on sign-out or when Expo reports DeviceNotRegistered.';

create index push_tokens_user_active_idx on public.push_tokens (user_id) where revoked_at is null;

revoke all on public.push_tokens from anon, authenticated;
alter table public.push_tokens enable row level security;
