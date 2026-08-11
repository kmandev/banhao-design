-- BANHAO — rider domain: riders, documents, availability
--
-- Implements docs/DATABASE_DESIGN.md § 5. `riders` is what establishes the
-- Rider capability under DEC-033 — there is no separate role grant.
--
-- rider_availability stores ONLY the latest position, deliberately. No
-- location history table exists: Q-012 (PDPA) is LEGAL_REVIEW_REQUIRED, and
-- no location schema should exist before the legal basis does (DBQ-005).
-- service_area_id / zone_id are bare uuid columns with no FK — the geo
-- domain is deferred from this migration set.

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  full_name text not null,
  vehicle_type text,
  plate text,
  status text not null default 'REGISTERED' check (status in (
    'REGISTERED', 'DOCUMENTS_SUBMITTED', 'PENDING_APPROVAL', 'APPROVED',
    'DOCUMENTS_REJECTED', 'SUSPENDED', 'DEACTIVATED'
  )),
  service_area_id uuid, -- no FK yet — geo domain deferred
  zone_id uuid,         -- no FK yet — geo domain deferred
  rating_avg numeric(2, 1) check (rating_avg is null or rating_avg between 0 and 5),
  rating_count int not null default 0 check (rating_count >= 0),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint riders_user_id_key unique (user_id)
);

comment on table public.riders is
  'Establishes the Rider capability (DEC-033) — a profile with a riders row IS a rider, no separate role grant exists. Only APPROVED riders may go online (enforced by the application, not this schema).';

create index riders_status_idx on public.riders (status);

create trigger riders_set_updated_at
  before update on public.riders
  for each row execute function public.set_updated_at();

-- Never hard-deleted — status moves to DEACTIVATED instead (§ 13).
create trigger riders_reject_delete
  before delete on public.riders
  for each row execute function public.reject_delete();

revoke all on public.riders from anon, authenticated;
alter table public.riders enable row level security;

-- ---------------------------------------------------------------------------
-- rider_documents
-- ---------------------------------------------------------------------------
--
-- doc_type is free text, deliberately unconstrained: BQ-022 (which
-- documents are actually required) is OPEN, so the table stores whatever is
-- submitted without prescribing the set (docs/DATABASE_DESIGN.md § 5).

create table public.rider_documents (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders (id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rider_documents is
  'doc_type is unconstrained free text — BQ-022 (which documents are required) is OPEN. Sensitive: no client SELECT of another rider''s documents; operator-only review.';

create index rider_documents_rider_idx on public.rider_documents (rider_id);

create trigger rider_documents_set_updated_at
  before update on public.rider_documents
  for each row execute function public.set_updated_at();

revoke all on public.rider_documents from anon, authenticated;
alter table public.rider_documents enable row level security;

-- ---------------------------------------------------------------------------
-- rider_availability — latest position only, no history (DBQ-005)
-- ---------------------------------------------------------------------------
--
-- Separate from `riders` because this row is written on every location
-- ping while `riders` changes a few times a year — keeping the high-churn
-- columns out of the identity row (docs/DATABASE_DESIGN.md § 5).

create table public.rider_availability (
  rider_id uuid primary key references public.riders (id) on delete cascade,
  is_online boolean not null default false,
  last_lat numeric(9, 6),
  last_lng numeric(9, 6),
  location geography(Point, 4326) generated always as (
    case when last_lat is not null and last_lng is not null
      then st_setsrid(st_makepoint(last_lng, last_lat), 4326)::geography
      else null
    end
  ) stored,
  location_updated_at timestamptz,
  active_delivery_count int not null default 0 check (active_delivery_count >= 0),
  -- Dormant under DEC-016 (no rider ever holds cash while COD is disabled),
  -- retained not removed. Unconstrained: the set of block reasons is not a
  -- decided vocabulary.
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rider_availability is
  '🔴 Most privacy-sensitive table in the schema — continuous rider location. Latest position ONLY; no history table exists, and none should before Q-012 answers the legal basis (DBQ-005). Per docs/DATABASE_DESIGN.md § 18: a rider may SELECT and UPDATE (is_online) their own row; customers get no access at all; everything else is API-only.';

create index rider_availability_online_location_idx
  on public.rider_availability using gist (location)
  where is_online;

create trigger rider_availability_set_updated_at
  before update on public.rider_availability
  for each row execute function public.set_updated_at();

revoke all on public.rider_availability from anon, authenticated;
alter table public.rider_availability enable row level security;
