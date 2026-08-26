# BANHAO — POD + Driver UI Implementation Plan

**Status:** ANALYSIS + PLAN ONLY — nothing implemented, no migration, no schema
change, no storage bucket, no live data touched.
**Written:** 2026-08-26
**Repository inspected at:** `b98d09e5` (branch `feature/g7-driver-availability`),
working tree clean apart from two untracked docs.
**Design artifacts read at:** `docs/design/BANHAO Driver App Redesign.dc.html`,
`docs/design/BANHAO POD UX Design.dc.html` (both authored against `7bd8d61`).

> **A note on `CLAUDE.md`.** The orientation file in the repository root is
> materially stale on three points and should not be used to scope this work:
> it says the Driver app is "not started" (it has six screens, seven
> repositories, four hooks and a passing test suite), it says there are 16
> migrations (there are 19), and it says Phases E/F/G are "not started"
> (Order, Payment-on-null-provider and Rider/dispatch through `EN_ROUTE` are
> all merged). Everything below is read out of the repository, not out of
> `CLAUDE.md`. Reconciling that file is a separate task and is listed in §15.

---

## 1. Executive Summary

Both designs are implementable, and both are much closer to the existing
architecture than a first reading suggests. The headline conclusions:

1. **POD needs no migration.** `deliveries.proof_photo_path text` is already in
   the deployed schema (`20260811000009_delivery_domain.sql:32`), nullable, no
   default. `delivered_at`, `state = 'DELIVERED'` and the
   `delivery_status_history` append-only trail all exist. The POD design's
   headline finding is **confirmed by inspection**.

2. **POD needs no new delivery state.** The deployed `deliveries.state` CHECK
   has no `ARRIVED`, no `POD_CAPTURED`, no `CONFIRMED`, no `COMPLETED`. The
   design's decision to make arrival-at-customer a *screen* state and POD a
   *precondition* of the existing `EN_ROUTE → DELIVERED` transition is the only
   option available under the schema lock, and it is the right one.

3. **The single genuinely blocking gap is the `delivered` command**, and it
   blocks G-7.2 with or without POD. `RiderController` exposes `location`,
   `offers/:id/accept`, `offers/:id/decline`, `deliveries/:id/arrived`,
   `picked-up`, `en-route` and `cancel`. There is no route that reaches
   `DELIVERED`. The **order-side half already exists and has no caller** —
   `OrdersService.completeDelivery` (`orders.service.ts:308`) implements
   `DELIVERING → DELIVERED` exactly as `startDelivery` did before G-6 wired it.

4. **Storage is Cloudflare R2, not Supabase Storage.** The task brief's §4 and
   §7 questions ("does BANHAO have Supabase Storage integration", "is Supabase
   Storage RLS sufficient") have a single answer: **there is no Supabase
   Storage anywhere in this system** — no bucket, no `storage.objects` policy,
   no migration referencing it. `StorageService` wraps the AWS S3 SDK against
   R2 behind a provider-agnostic boundary. Because R2 has no per-user
   authorization mechanism at all, a **server-mediated presign flow is not one
   option among several — it is the only one**, and it is already the
   established, twice-implemented pattern (`restaurant-cover.*`,
   `menu-item-image.*`).

5. **One security finding the POD design did not surface.** The system is
   configured for a **single R2 bucket with a public base URL**
   (`R2_PUBLIC_URL`, documented in `.env.example` as "a custom domain or R2.dev
   URL"). R2 public access is granted **per bucket**, not per object. Placing
   `deliveries/{id}/proof/{uuid}.jpg` in that bucket makes it fetchable by
   anyone who has the key, and the signed-download design would then be
   privacy-by-obscurity (a 122-bit unguessable key) rather than
   privacy-by-authorization. **Recommendation: a second, private bucket.** In
   R2 this costs nothing extra — billing is by stored bytes and operations, not
   by bucket. See §7.3. This is the one place where this plan departs from the
   design artifact, and it is an addition, not a contradiction.

6. **R2 is not provisioned.** All five `R2_*` variables are optional in
   `packages/config/src/env.ts` and empty in `.env.example`, whose comment says
   "Fill them in only once R2 is actually provisioned." The two merchant upload
   endpoints that exist are therefore **unexercised against a real bucket
   today**. POD is the first feature that will force provisioning, and the
   first that would make a misconfiguration a privacy incident rather than a
   broken image.

7. **The Driver redesign is genuinely non-blocking.** It is presentation-only:
   no new query, no new endpoint, no schema, RLS or business-rule change. Its
   own readiness verdict ("READY — 6 DATA GAPs, none blocking a frame") holds
   against the repository. Its four load-bearing constraints (don't disable a
   zero countdown, don't patch the list locally, don't add a second timer,
   don't render a disabled toggle for a non-approved rider) are all real and
   all map to named tests in `docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md`.

8. **Two Product Owner decisions block the confirm screen and nothing else:**
   POD-Q-01 (is the photo mandatory) and POD-Q-02 (what a rider who genuinely
   cannot photograph does). Engineering can specify and build all four backend
   capabilities in parallel — none of them depends on either answer.

**Recommended sequencing:** the `delivered` command first, on its own, because
it unblocks G-7.2 independently; then the active-delivery screen; then POD on
top of it. POD is the last layer, not the first.

---

## 2. Design Artifacts Reviewed

| Artifact | Sections | What it commits to |
|---|---|---|
| `docs/design/BANHAO Driver App Redesign.dc.html` | §0 repository findings (RF-01…14), §A overview + DD-01…07, §B IA, §C 13 frames, §D 33 semantic tokens (17 existing / 16 new) + type scale, §E state matrix, §F G7.1 test compatibility A–S, §G file-by-file handoff, §H DATA GAPs DG-01…06, §I report | A presentation-only redesign of 6 existing screens. No new route, no new read path, no backend change. |
| `docs/design/BANHAO POD UX Design.dc.html` | §0 findings (PF-01…14), §A scope + 6 dark tokens, §B state-machine integration, §C 10 rider frames (P-01…P-10), §D 4 customer frames (C-14, C-19, C-19b, C-19c), §E screen inventory + navigation, §F 11-row failure matrix, §G capabilities POD-C-01…06, §H storage/access model, §I privacy + a11y, §J analytics, §K 14 acceptance criteria, §L open decisions POD-Q-01…07, §M report | POD as a client-side capture flow terminating in one server command. No new delivery state, no new table, no migration. |

Both artifacts were verified claim-by-claim against the repository. **Every
repository claim in both documents that this analysis checked was accurate.**
The verifications are recorded inline throughout §§3–7 below.

### 2.1 Driver App — extracted requirements

**Screen hierarchy / navigation.** Two native stacks selected by the Supabase
session alone; no tab bar (งานของฉัน is G-7.2, รายได้ is BQ-029/`OPEN`, so three
of four tabs would open onto nothing). `SESSION = NULL` → Splash · Login ·
Otp. `SESSION SET` → Home, gated on a **fresh** `riders` read on every mount:
`≠ APPROVED` renders Status (a component, not a route) with **no toggle
anywhere in the tree**; `APPROVED` renders availability + the offer entry row.
OfferInbox is the one pushed route and the only polling screen.

**Rider workflow.** Going online is *capture position → `POST /rider/location`
→ set `is_online`*; any failure leaves the rider offline and says why.

**Offer workflow.** Direct Supabase read of `rider_assignment_attempts` filtered
`outcome = 'PENDING'` (no `expires_at` filter, so expired-but-PENDING offers
list and must stay actionable). Accept/decline via
`POST /api/v1/rider/offers/:id/{accept,decline}`; one action at a time via
`busyOfferId`; the list is **re-read** after every action, never patched.

**States required.** Loading (button spinner, centred spinner, card-level
spinner), empty (`ยังไม่มีงาน`, explicitly not an error), error (full-screen
ErrorState + mono server message + retry; the 15 s timer keeps running),
offline (ConnectionBanner + ErrorState), disabled/inert (non-acting cards dim
to 45%; toggle inert while busy), edge (expired-but-PENDING offer; online with
no recorded position; profile read failure must **never** render as "not
approved").

**Confirmation interactions.** None. No dialog, no swipe-to-confirm. Emphasis
carries consequence: `รับงาน` 66% width / filled / 60 px / thumb-side,
`ปฏิเสธ` 34% / outlined, 10 px apart, never adjacent to a screen edge.

**Polling / realtime.** Fetch on focus, 15 000 ms interval while focused, timer
cleared on blur, immediate fetch on refocus, post-action re-read coalesced by
`refreshPending`. **No Realtime** (TQ-002 `OPEN`; `rider_assignment_attempts`
is not in the realtime publication and adding it is a migration).

**Map / location.** No map. `expo-location` foreground only, captured at the
moment of going online or refreshing. No background tracking.

**Photo / camera / permissions.** None in the Driver redesign — that is
entirely the POD design's scope.

**Offline / retry.** Retry is always a read (idempotent). No queue, no
background task, no auto-retry beyond the existing 15 s poll.

### 2.2 POD — extracted requirements

| Question asked in the brief | The design's answer |
|---|---|
| When POD becomes available | When the delivery is `EN_ROUTE` and the rider taps `ถึงจุดส่งแล้ว` — a **screen** state. There is no arrival server state and none is proposed. |
| Who can submit | Only the rider currently assigned to that delivery, only while it is `EN_ROUTE`. |
| Required vs optional photos | **POD-Q-01, OPEN.** Frames assume mandatory (with COD disabled the photo is the only evidence of handover — `RIDER_LIFECYCLE.md` §10, BQ-018). |
| Number of photos | Exactly one. Multiple photos are explicitly out of scope. |
| Camera / gallery | **Camera only.** No gallery picker in any frame — a gallery import would let a photo be taken anywhere, at any time, by anyone. |
| Photo preview | P-05 `ตรวจรูปก่อนยืนยัน`, a dedicated review screen. Nothing is uploaded from it. |
| Retake / delete | Unlimited retakes before confirmation; **impossible after**. Retake discards the local file and re-opens the camera. |
| Upload progress | P-07, a determinate progress bar with a `polite` live region announcing percentage. CTA inert throughout; back gesture blocked. |
| Upload failure | P-08. Photo preserved locally (`ไม่ต้องถ่ายใหม่`), delivery untouched and still open, retry restarts from whichever step failed. |
| Delivery completion conditions | A successful `delivered` command response — and nothing else. `ส่งสำเร็จ` appears in no other screen state. |
| Signature | Not required. Explicitly out of scope. |
| Recipient name / phone / OTP | Not required. Name and drop point are *displayed* (from the existing assigned-order read path); nothing new is collected. |
| Timestamp | `delivered_at` (existing column) is the confirmation time. Capture time is **POD-Q-03** — read from object metadata, not stored, unless the PO wants a column (which would be a migration). |
| Location | **Not captured with the photo.** No geotag, no coordinate in any event. |
| Metadata | Object key only. No EXIF handling is designed either way — see §5.6 for why that is a real gap. |
| Storage | Cloudflare R2 via `StorageService`. Key `deliveries/{deliveryId}/proof/{uuid}.{ext}`, server-templated, never client-supplied. |
| Security / privacy | Presign scoped to one object/one operation/one content type/5 minutes; short-lived signed GET per request; never a public URL, never the stored path. Retention: **none exists and none is designed** (POD-Q-04, gated on Q-012/PDPA). |
| Customer visibility | Yes — C-19 card + C-19b full-screen viewer. Image, two timestamps, one explanatory sentence. **No rider identity, no rider location.** |
| Merchant visibility | **Not in V1** (POD-Q-05). The RLS policy `deliveries_select_merchant` already exists, so it is a signed-URL endpoint away if the PO wants it. |
| Admin visibility | Service role only. No Admin app exists (Phase I). |

---

## 3. Current Architecture Summary

### 3.1 Delivery / rider backend (what actually exists)

`apps/api/src/modules/rider/` — `RiderController` plus six services:
`RiderLocationService`, `OfferAcceptanceService`, `DeliveryReleaseService`,
`DeliveryArrivalService`, `DeliveryPickupService`, `DeliveryEnRouteService`,
and `DispatchService` + `BroadcastDispatchStrategy` behind a
`DISPATCH_STRATEGY` token.

The house pattern for a rider command, established four times and to be
followed exactly by the `delivered` command:

1. `@Roles('RIDER')` is the approval gate — `CapabilitiesService` resolves
   `capabilities.rider` only for `riders.status = 'APPROVED'`, so no service
   re-checks approval.
2. A **guarded conditional UPDATE** carrying both ownership and the expected
   pre-state in the `WHERE` clause (ADR-003). Never `SELECT`-then-check.
3. The **winner only** writes `delivery_status_history`, immediately, before
   the order is touched.
4. The order half runs through the existing, unmodified `OrdersService`.
5. A **repair-on-retry tail** for the deliberately non-transactional gap
   between steps 2 and 4, which reports "the delivery already reflects this
   call's effect; finish the tail" rather than re-deciding anything.

`DeliveryEnRouteService` is the closest template and is heavily documented on
exactly this reasoning.

### 3.2 Storage

`apps/api/src/modules/storage/` — `StorageService` (S3 SDK against R2:
`upload`, `delete`, `exists`, `getPublicUrl`, `getSignedUploadUrl`, plus a
private `assertSafeObjectKey` rejecting `..`, leading `/`, empty segments) and
`object-key.ts` (`restaurantCoverObjectKey`, `menuItemImageObjectKey`,
`parseMenuItemImageObjectKey`, `ALLOWED_IMAGE_MIME_TYPES = jpeg|png|webp`).

`StorageModule` is imported by `MerchantModule`, which is in `AppModule`. The
upload contract, twice implemented:
`POST …/upload-url { contentType } → { uploadUrl, objectKey }`, client PUTs
straight to R2, then `POST …/complete { objectKey }` which **validates the key
structurally, proves it with `exists()`, and persists the object key — never a
URL**.

### 3.3 Driver app

Expo 52 / RN 0.76.5 / React Navigation native-stack. Six screens, seven
repositories, four hooks, four domain modules, four data-query modules. Reads
go direct to Supabase under RLS; writes go through `apiClient` to NestJS —
with the single sanctioned exception of `rider_availability.is_online`, written
client-side under a column-scoped grant. Dependencies include `expo-location`;
**no camera package, no `NSCameraUsageDescription`, no `android.permission.CAMERA`**
(verified in `apps/driver/package.json` and `apps/driver/app.json`).

`RiderOrderViewRepository` is built, tested and **consumed by no screen**.

### 3.4 Customer app

`OrderDetailScreen` reads through `repositories.orderDetail`, bound to
`supabaseOrderDetailRepository` (a direct Supabase read of `orders`,
`order_items`, `order_item_options`, `order_status_history`). **No customer
screen reads `deliveries` at all** — verified. `apiAddresses` /
`apiOrderCreation` are the precedent for a customer repository that goes
through the NestJS API instead.

---

## 4. Driver UI Gap Analysis

| # | Requirement | Class | Affected | Notes |
|---|---|---|---|---|
| D-1 | `StateCard` replaces `StatusStrip` (state + control in one card) | **MISSING** (component) | `apps/driver/src/components/` | New file; `StatusStrip.tsx` deleted. Variant mapping moves unchanged. |
| D-2 | `OfferCard` + `Countdown` extracted from `OfferInboxScreen` | **PARTIAL** | `src/screens/OfferInboxScreen.tsx` | The card exists inline; extraction is a refactor. `Countdown` is new, render-local, issues no request. |
| D-3 | `Toast`, `ConnectionBanner`, `EmptyState`, `ErrorState`, `ListRow`, `LivePill` | **MISSING** | `src/components/` | Presentation only, no data access. `ConnectionBanner` renders from existing error view state — **no connectivity library is added**. |
| D-4 | 16 new semantic tokens + driver type scale | **PARTIAL** | `packages/ui/src/theme/tokens.ts` | Strictly additive under a driver semantic layer; §D of the design enumerates every value, so nothing is decided at implementation time. Customer app unaffected. |
| D-5 | `Button` gains a `size` prop (lg/md/sm) | **PARTIAL** | `packages/ui/src/components/Button.tsx` | Behaviour, variants and a11y props unchanged. **Shared package — customer app regression risk; default must stay today's size.** |
| D-6 | Primary fill moves to `#C2431F` (existing `colors.primaryPressed`) | **CONFLICT (resolved)** | tokens | `#E4572E` on white = 3.68:1, below AA at the shipped 15 px label size (UX-FINDING-02). Adopting the existing darker token is the fix; no new colour enters the system. |
| D-7 | Zero on the countdown must **not** disable `รับงาน`/`ปฏิเสธ` | **EXISTS** (must be preserved) | `OfferInboxScreen` | Test I drives accept on an expired offer *through this screen*. Disabling would make the test unexecutable and put the client ahead of the server. |
| D-8 | Post-action re-read, never local list patching | **EXISTS** | `hooks/useRiderOfferInbox.ts` | Tests M, H. `refreshPending` coalescing untouched. |
| D-9 | Polling semantics: focus / 15 s / blur / refocus | **EXISTS** | `hooks/useRiderOfferInbox.ts` | Tests E, N, O, P, Q. No second timer, no background task, no Realtime. |
| D-10 | No toggle in the non-approved tree (absent, not disabled) | **EXISTS** | `screens/HomeScreen.tsx`, `StatusScreen.tsx` | Test B / DEC-UX-006. |
| D-11 | Offer count badge on Home (frame R-03b) | **MISSING** (DG-05) | `HomeScreen`, `riderOfferInbox` repo | Needs a focus-only read (no timer), reusing the existing repository. **NEEDS_DECISION**: is a one-shot read on Home focus within polling policy? |
| D-12 | Restaurant / pickup / dropoff / distance on the offer card | **CONFLICT — by design** (DG-01) | — | `rider_assignment_attempts` projects six columns, none a place. The table's own comment names this a **privacy boundary**: an unaccepted rider is not a party to the order. **Do not widen it.** The card states the boundary in one line. |
| D-13 | `ค่ารอบ` / any money on a rider surface | **NEEDS_DECISION** (DG-02) | — | BQ-029 `OPEN`; `deliveries.rider_earning_satang` stays NULL by instruction. Show **no** money — not a zero, not a dash, not "รอยืนยัน". |
| D-14 | Push notification of a new offer | **MISSING** (DG-03) | — | TQ-002 `OPEN`. Keep the 15 s foreground poll; make its liveness visible (pulsing pill) so "no work" is distinguishable from "not looking". |
| D-15 | Active-delivery screen (R-06+) | **MISSING** (DG-04) | — | See §4.1. This is G-7.2 and it is the real dependency for POD. |
| D-16 | Today's summary on Home | **MISSING** (DG-06) | — | Nothing aggregates completed deliveries or hours; the money half is BQ-029. Design recommends omitting it. |
| D-17 | Icon set | **NEEDS_DECISION** | — | Every glyph in both designs is an emoji carried over from today's code. Emoji render differently per Android OEM. No repository document specifies an icon set. |

### 4.1 DG-04 — the active-delivery blocker, verified

Two independent halves, both confirmed by inspection:

1. **No completion endpoint.** `RiderController` has no `delivered` route.
   `OrdersService.completeDelivery` (`DELIVERING → DELIVERED`, writes
   `delivered_at`) exists and **has no caller anywhere in the API** —
   precisely the state `pickupOrder` and `startDelivery` were in before G-5 and
   G-6 wired them.
2. **No delivery-state read path for the rider.** `rider_order_view`
   (`20260811000012_rider_order_views.sql:119`) projects 19 columns —
   `id, order_number, state, restaurant_id, restaurant_name_snapshot,
   delivery_address_snapshot, delivery_lat, delivery_lng, delivery_landmark,
   recipient_name_snapshot, recipient_phone_snapshot, distance_m,
   quoted_eta_minutes` and seven timestamps. **No `delivery_id`, no delivery
   state, no `proof_photo_path`.** After an app restart the client cannot tell
   which step the rider is on from this view.

   The `orders.state` column *is* projected, and it shadows the delivery state
   closely enough (`READY_FOR_PICKUP` / `PICKED_UP` / `DELIVERING`) to drive
   the four-step UI. But `deliveryId` is required as a path parameter by every
   rider delivery command, so it must come from somewhere. **`deliveries_select_rider`
   already grants the assigned rider full-row SELECT on `deliveries`**
   (`20260811000011_rls_policies.sql:566`), so the client can read
   `id`, `state` and `order_id` from `deliveries` directly under existing RLS
   — **no migration, no new view**. That is this plan's recommendation, and it
   closes DG-04's second half without touching the schema. The cost is that the
   rider's client also receives `rider_earning_satang` (NULL) and
   `proof_photo_path` on that row; both are acceptable — one is the rider's own
   and null, the other is the rider's own photo path, useless without a
   signature.

---

## 5. POD Gap Analysis

| # | Requirement | Class | Notes |
|---|---|---|---|
| P-1 | A column to store the proof path | **EXISTS** | `deliveries.proof_photo_path text`, nullable. Verified. |
| P-2 | A completion timestamp | **EXISTS** | `deliveries.delivered_at`, and `orders.delivered_at` written by `completeDelivery`. |
| P-3 | A `DELIVERED` delivery state | **EXISTS** | In the deployed CHECK. |
| P-4 | An audit row for the transition | **EXISTS** | `delivery_status_history`, append-only, `actor_type = 'RIDER'`. |
| P-5 | The `delivered` command | **MISSING — BLOCKING** | POD-C-01. See §8.1. |
| P-6 | A proof presign endpoint | **MISSING — BLOCKING** | POD-C-02. Pattern exists twice. |
| P-7 | A delivery-proof key builder + parser | **MISSING — BLOCKING** | POD-C-03. `object-key.ts` names it as its own anticipated third sibling. |
| P-8 | `getSignedDownloadUrl` on the storage boundary | **MISSING — BLOCKING** | POD-C-04. `StorageService` has no download-signing method; `getPublicUrl` documents itself as *"never for a private key such as a future delivery-proof photo."* |
| P-9 | A private bucket for POD objects | **MISSING — NOT IN THE DESIGN** | See §7.3. This plan adds it. |
| P-10 | Camera capability in the driver app | **MISSING — DEPENDENCY** | POD-C-05. Package + `NSCameraUsageDescription` + `android.permission.CAMERA`. |
| P-11 | An active-delivery screen to host the POD leg | **MISSING** | G-7.2. POD's frames P-01/P-02 sit on a screen that does not exist. |
| P-12 | A customer proof read path | **MISSING** | POD-C-06. No customer screen reads `deliveries` today. |
| P-13 | Rider slot release on completion (`active_delivery_count 1 → 0`) | **MISSING — NOT IN THE DESIGN** | See §5.1. **This is the most consequential omission in the POD design.** |
| P-14 | Closing the `rider_assignments` row as `COMPLETED` | **MISSING — NOT IN THE DESIGN** | See §5.2. |
| P-15 | Image compression / resizing before upload | **MISSING** | Nothing anywhere in the repo compresses an image. See §5.5. |
| P-16 | EXIF stripping | **MISSING** | See §5.6. |
| P-17 | Retention / purge mechanism | **MISSING — NEEDS_DECISION** | POD-Q-04, gated on Q-012 (PDPA). Nothing exists; "kept indefinitely" is what building nothing produces. |
| P-18 | Orphan cleanup | **MISSING — accepted** | Consistent with the two existing upload flows, which document the same accepted orphan behaviour. |
| P-19 | Database-level immutability of `proof_photo_path` | **CONFLICT — accepted as an application rule** | POD-Q-07. `deliveries` deliberately carries no column-immutability trigger. The state guard (`WHERE state = 'EN_ROUTE'`) is what makes a second write impossible in practice. |
| P-20 | Analytics events | **MISSING — out of scope** | No analytics infrastructure exists anywhere in this repository. `delivery_status_history` answers the operational question. |

### 5.1 P-13 — the rider slot leak (found by this analysis, not in the design)

`OfferAcceptanceService.claimRiderSlot` sets
`rider_availability.active_delivery_count = 1` under a CAS
(`WHERE active_delivery_count = 0`) — that is the one-active-delivery-per-rider
enforcement. `DeliveryReleaseService.repairAvailability` resets it `1 → 0`
under the mirror CAS when a rider *cancels*.

**Nothing resets it on completion, because completion does not exist yet.** If
the `delivered` command is written without that reset, **every rider becomes
permanently unable to accept another offer after their first successful
delivery** — silently, with the dispatcher simply never selecting them again
(`BroadcastDispatchStrategy` requires `active_delivery_count = 0`). This must
be in the delivered command's tail, as a guarded CAS, exactly as
`repairAvailability` does it.

### 5.2 P-14 — closing the assignment row

`release_rider_assignment()` accepts only `p_status in ('CANCELLED','RELEASED')`
and only from `state in ('RIDER_ASSIGNED','RIDER_REASSIGNING')`, so it **cannot
be used for completion** — verified by reading the function body. The
`rider_assignments.status` CHECK does include `'COMPLETED'`, and
`rider_assignments_one_active` (the partial unique index on
`delivery_id where status = 'ACCEPTED'`) would leave a completed delivery's row
`ACCEPTED` forever if nothing closes it. That is not an active-delivery hazard
(the delivery is terminal and will never be re-offered), but it corrupts the
claim history and would misreport rider completion counts. The delivered
command should close it with a plain guarded UPDATE
(`WHERE delivery_id = :id AND rider_id = :r AND status = 'ACCEPTED'`) — **not**
through the RPC, which would reject it.

### 5.3 Idempotency

The design is right that the command must be idempotent: a rider at a door
cannot distinguish a lost response from a failed one. The repair path is the
existing `DeliveryEnRouteService.repairEnRoute` shape — a retry whose delivery
is already `DELIVERED` **and still owned by the caller** returns success,
re-attempts only the order half, and **writes no second history row** (there is
no unique constraint on `delivery_status_history`, so an
existence-check-then-insert heal would be genuinely race-prone; not writing is
the only duplicate-free answer available without a migration).

One POD-specific subtlety the design's acceptance criterion #7 implies but does
not spell out: on the repair path the command must **not** overwrite
`proof_photo_path` with the retry's key. The guarded UPDATE's
`WHERE state = 'EN_ROUTE'` already prevents this structurally — the second call
matches zero rows and never reaches the write.

### 5.4 What happens between upload and command

The design's answer is correct and worth restating because it is the reason POD
needs no upload-session table: **the completion *is* the command**. There is no
`complete` step of its own. An uploaded-but-unconfirmed object is an orphan and
nothing else — no row references it, no state moved. This removes both bad
states the merchant flows tolerate (a photo recorded against an incomplete
delivery, and a completed delivery with no photo).

### 5.5 Compression — a real gap

A modern phone camera produces 3–8 MB JPEGs. Nothing in this repository resizes
or re-encodes an image; the two merchant flows presign and PUT whatever the
client produces. For a rider on rural Thai mobile data at a doorway, an
uncompressed upload is the single most likely cause of the P-08 failure state.
**Client-side resize before upload is required, not optional** — target ~1600 px
long edge, JPEG quality ~0.7, which lands comfortably under 500 KB and is
ample evidence. `expo-image-manipulator` is the natural companion to
`expo-camera`. Server-side processing is explicitly *not* recommended (see §13).

### 5.6 EXIF — a decision the design did not make

A camera JPEG can carry GPS coordinates, device identifiers and a precise
timestamp. The POD design deliberately captures no location — but an unstripped
EXIF block would smuggle one in anyway, into an object the customer can
download. Re-encoding through `expo-image-manipulator` (§5.5) drops EXIF as a
side effect, which is the cheapest correct answer. **This should be stated as a
requirement and tested, not left as a by-product.**

---

## 6. Database Gap Analysis

Answering §5 of the brief, question by question, from the deployed schema.

| Question | Answer |
|---|---|
| Can a delivery have POD records today? | **Yes.** `deliveries.proof_photo_path text`, nullable. No migration required. |
| Can multiple photos belong to one delivery? | **No** — one text column, one path. The design scopes POD to exactly one photo, so this is a match, not a gap. Multiple photos would need a new table and a migration. |
| How is photo ordering represented? | Not represented, and not needed at one photo. |
| How is uploaded object ownership represented? | By the object **key**, which embeds the delivery id (`deliveries/{deliveryId}/proof/{uuid}.{ext}`), plus `deliveries.rider_id`. There is no separate ownership record and none is needed. |
| How is upload completion represented? | By `proof_photo_path` being non-null — which only the delivered command ever sets, in the same guarded UPDATE that moves the state. There is no intermediate "uploaded" flag by design. |
| Can POD be submitted twice? | **Not through the command.** The guarded `WHERE state = 'EN_ROUTE'` matches zero rows on a second call. Note honestly: *the database does not prevent it* — `deliveries` has no column-immutability trigger (deliberately: `state` and `rider_id` must advance freely), so a service-role writer could overwrite the path. Application rule, not a database guarantee (POD-Q-07). |
| How is idempotency guaranteed? | By the guarded UPDATE plus the repair path (§5.3). The winner writes history; a retry re-attempts only the order half and writes nothing. |
| What prevents another rider/customer attaching a photo? | Layered: `@Roles('RIDER')` (approved riders only) → the presign endpoint's assigned-rider + `EN_ROUTE` check → the key builder templating the key server-side from the *authorized* delivery id → the command's `WHERE rider_id = :riderId AND state = 'EN_ROUTE'`. A customer has no route at all — no client may write `deliveries` (`revoke all … from anon, authenticated`; only SELECT policies exist). |
| What prevents a rider uploading to another delivery? | The key is never client-supplied. The presign templates it from a delivery id the server has already proven the caller is assigned to; the command re-parses the submitted key against *that same* authorized delivery id and refuses a mismatch. |
| Upload succeeds, DB transaction fails? | The object is an **accepted orphan** and the delivery stays `EN_ROUTE`. The rider retries; the design's state matrix has the client hold the object key so the retry sends the command alone rather than re-uploading. Nothing is lost and no state is faked. |
| DB row exists but the storage object is missing? | Cannot arise through the sanctioned path — the command calls `exists()` **before** writing anything, so the row is never created without bytes behind it. It can arise *afterwards*, if an object is deleted out-of-band (there is no deletion path today). The customer read must then fail gracefully: C-19c's "no proof" card is the right fallback, and the signed-URL endpoint should return null rather than a broken image. **Worth an explicit test.** |

**Migrations required: NONE.** Three optional migrations are identified in §15
as decisions, not requirements: a `captured_at` column (POD-Q-03), a
column-immutability trigger for `proof_photo_path` (POD-Q-07), and adding
`delivery_id`/delivery state to `rider_order_view` (superseded by the
`deliveries_select_rider` route in §4.1, and therefore not recommended).

---

## 7. Storage Architecture

### 7.1 What exists

Cloudflare R2 behind `StorageService`, an S3-SDK-based provider boundary. No
business module may import `@aws-sdk/client-s3` directly. Object keys are
always server-templated from validated UUIDs and allow-listed MIME types; the
client never supplies a key or a filename. `assertSafeObjectKey` re-checks
every key for `..`, a leading `/` and empty segments even though every key the
module produces is safe by construction.

**There is no Supabase Storage.** No bucket, no `storage.objects` policy, no
migration mentioning it. The brief's §4/§7 Supabase Storage questions are
therefore answered by "not applicable — and do not introduce it," since it
would be a second storage provider alongside R2 for no gain.

### 7.2 The POD flow

```
Rider taps ส่งสำเร็จ
  → POST /api/v1/rider/deliveries/:id/proof/upload-url { contentType }
        server: assigned-rider check + state = EN_ROUTE check
        server: deliveryProofObjectKey(deliveryId, mimeType)
        → { uploadUrl (5 min, one object, one PUT, one Content-Type), objectKey }
  → client PUT bytes straight to R2      (never through Cloud Run)
  → POST /api/v1/rider/deliveries/:id/delivered { objectKey }
        server: parseDeliveryProofObjectKey(objectKey, deliveryId)  → structure
        server: StorageService.exists(objectKey)                    → real bytes
        server: guarded UPDATE deliveries (EN_ROUTE → DELIVERED, path, delivered_at)
        server: delivery_status_history (winner only)
        server: OrdersService.completeDelivery  (DELIVERING → DELIVERED)
        server: rider_assignments → COMPLETED
        server: rider_availability.active_delivery_count 1 → 0 (CAS)
```

Reading, per audience, always: **authorize → mint a short-lived signed GET →
return it, never persisted.**

### 7.3 The private-bucket recommendation

This is the one substantive addition this plan makes to the design.

`R2_PUBLIC_URL` is documented in `.env.example` as *"a custom domain or R2.dev
URL … Public objects only; never used for a private key."* That comment
correctly constrains `getPublicUrl` — but it does not constrain **R2**. Public
access in R2 is a **bucket-level** setting: if the bucket behind
`R2_PUBLIC_URL` is publicly readable, then `https://<public-base>/deliveries/
{id}/proof/{uuid}.jpg` is fetchable by anyone with the key, regardless of what
the API does. The signed-download design would then be defence against
enumeration only, not against access.

**Recommendation: two buckets.**

| Bucket | Contents | Access |
|---|---|---|
| `R2_BUCKET` (existing) | restaurant covers, menu item images | public read via `R2_PUBLIC_URL` |
| `R2_PRIVATE_BUCKET` (new) | delivery proof photos | **no public access**; reachable only by signed URL |

Cost: nothing. R2 bills stored bytes, Class A/B operations and (zero) egress —
not buckets. Operational complexity: one environment variable and one extra
field on `StorageService`. This is strictly cheaper and simpler than any
alternative (a Worker in front of the bucket, an API byte-proxy, per-object
ACLs) and it makes the privacy property structural rather than dependent on
nobody ever calling `getPublicUrl` with a proof key.

`StorageService` should therefore gain a bucket parameter (or a second,
explicitly-named private-object method set) rather than assuming one bucket.
This is a small, contained change to a file whose entire purpose is to be the
one place storage details live.

### 7.4 Validation, limits, orphans

| Concern | Position |
|---|---|
| MIME validation | Allow-list reused from `ALLOWED_IMAGE_MIME_TYPES` (jpeg/png/webp). The presigned PUT is scoped to one `Content-Type`, so a client that uploads different bytes than it declared gets a rejected PUT from R2. **MIME spoofing note:** the declared type binds the key's extension and the PUT; the *bytes* are never sniffed. Since the object is only ever served back through a signed URL to authenticated audiences and never executed, this is acceptable — and it is the same posture the two existing flows already take. |
| File size | **No limit exists anywhere today.** A presigned PUT does not cap size unless the policy says so. With client-side compression (§5.5) the practical ceiling is ~500 KB; a server-side ceiling should be added via a `ContentLength`-conditioned presign if the SDK path allows it cleanly, and otherwise enforced by rejecting oversized objects at `exists()`/`HeadObject` time (which returns size). **Recommend the latter — it is simple, needs no new mechanism, and the command already calls `HeadObject`.** |
| Orphans | Accepted and documented, exactly as the two existing flows accept them. A retake and an abandoned attempt each leave one unreferenced object. No cleanup job is specified, and inventing one is out of scope. |
| Deletion | No deletion path is designed. `StorageService.delete` exists but nothing calls it for proofs. Correct — evidence should not be deletable by any client. |
| Retention | **None. POD-Q-04 / Q-012.** Stated plainly rather than presented as a decision: building nothing produces "kept indefinitely," which is a PDPA exposure and needs a purge mechanism specified *before* the first photo is stored. |

---

## 8. API Architecture

Four new endpoints and one new storage method. Every one follows an existing,
twice- or four-times-implemented pattern.

### 8.1 `POST /api/v1/rider/deliveries/:id/delivered` — BLOCKING

```
@Roles('RIDER')   body { objectKey }   200
→ { deliveryId, state: 'DELIVERED', orderId, orderState: 'DELIVERED', deliveredAt }
403 NOT_ASSIGNED_RIDER · 404 NOT_FOUND (delivery, or no object at the key)
409 INVALID_TRANSITION (delivery not EN_ROUTE)
```

New service `DeliveryCompletionService`, modelled on `DeliveryEnRouteService`.
Calls the existing, unmodified `OrdersService.completeDelivery`. Tail:
`rider_assignments → COMPLETED`, `active_delivery_count 1 → 0` (CAS). Repair
path as §5.3.

If POD-Q-01 resolves to *optional*, `objectKey` becomes optional and everything
else is unchanged — which is why this endpoint is not blocked on that decision.

### 8.2 `POST /api/v1/rider/deliveries/:id/proof/upload-url` — BLOCKING

```
@Roles('RIDER')   body { contentType }   200 → { uploadUrl, objectKey }
403 NOT_ASSIGNED_RIDER · 409 INVALID_TRANSITION (not EN_ROUTE)
```

Direct analogue of `MenuItemImageController.requestUploadUrl`, with the
assigned-rider + state check replacing the restaurant-membership check.

### 8.3 `GET /api/v1/orders/:id/delivery-proof` — BLOCKING (customer)

```
authenticated, order's own customer   200 → { photoUrl, capturedAt, deliveredAt } | null
403 / 404 indistinguishable for a foreign order
```

Mints a short-lived signed GET per request. Returns `null` (rendering C-19c)
for a delivered order with no path, and for an order whose object has gone
missing. Deliberately **not** a direct Supabase read of `deliveries`: the
existing `deliveries_select_customer` policy would work and is the wrong path —
it hands the client `rider_id` and `rider_earning_satang` to obtain one
nullable text column (POD-C-06).

### 8.4 `StorageService.getSignedDownloadUrl(key, expiresInSeconds)` — BLOCKING

One method on the existing boundary (`GetObjectCommand` + the same
`getSignedUrl` presigner already imported). Short expiry — minutes. Never
persisted, never logged. Must target the **private** bucket (§7.3).

### 8.5 Not built

A rider-facing proof read endpoint (the rider has the local file and, after
completion, no reason to re-fetch), a merchant endpoint (POD-Q-05), an admin
endpoint (no Admin app until Phase I), and any delete or replace route
(evidence).

---

## 9. Security Model

Answering §7 of the brief, threat by threat.

| Threat | Control | Sufficient? |
|---|---|---|
| Arbitrary authenticated user uploads POD | `@Roles('RIDER')` (approved riders only) → presign endpoint's assigned-rider check → command's `WHERE rider_id = :riderId` | **Yes.** Three independent layers. |
| Rider A uploads to Rider B's delivery | The key is server-templated from a delivery id the caller was proven assigned to; the command re-parses the key against that same id | **Yes.** A key for another delivery fails the parse; a key with the right shape but no bytes fails `exists()`. |
| Customer uploads rider evidence | No customer route exists; no client may write `deliveries` at all (`revoke all … from anon, authenticated`, SELECT policies only) | **Yes, structurally.** |
| Direct public access to POD images | **INSUFFICIENT AS DESIGNED — see §7.3.** With one shared public bucket, the objects are fetchable by key. With the recommended private bucket, access requires a signature the API only issues to an authorized audience. | **Only with the private bucket.** |
| Path traversal | Keys are never client-supplied for construction; `assertSafeObjectKey` rejects `..`, leading `/`, empty segments; the parser demands an exact segment count and a UUID in each position | **Yes.** Two independent layers. |
| MIME spoofing | Allow-list + `Content-Type`-scoped presign. Bytes are not sniffed. Objects are never executed and are served only to authorized audiences | **Acceptable**, and identical to the existing flows' posture. |
| Oversized files | **Nothing today.** Mitigated by client compression + a `HeadObject` size check at command time (§7.4) | **Only once added.** Must be built. |
| Unauthorized deletion | No delete route for proofs; `deliveries_reject_delete` blocks row deletion for every role | **Yes.** |
| Unauthorized replacement | The command's `WHERE state = 'EN_ROUTE'` makes a second write unreachable. Note honestly: the *database* does not enforce it (no immutability trigger) — POD-Q-07 | **In practice yes; not a database guarantee.** |
| Service-role credentials in the mobile app | The driver app holds only the Supabase anon key; `R2_SECRET_ACCESS_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only, both flagged in `.env.example` and `packages/config/src/env.ts`. The rider's client receives only presigned URLs — single-object, single-operation, five-minute authorizations, never credentials | **Yes.** CON-005 upheld. |

**Is Supabase Storage RLS sufficient, or is a server-mediated flow required?**
The question does not arise: Supabase Storage is not in use, and R2 offers **no
per-user authorization primitive of any kind**. A server-mediated presign flow
is the only available architecture, it is already implemented twice, and it is
also the *correct* one — it keeps image bytes off Cloud Run, keeps credentials
server-side, and makes every authorization decision in code that can be tested.

**Simplest secure architecture, recommended:** the existing presign pattern,
one private bucket, signed GETs minted per request, and the completion folded
into the delivered command. No new provider, no new service, no queue, no
Worker.

---

## 10. Delivery State Machine Mapping

Using the repository's real state names — no invented states.

```
CURRENT STATE (deployed, deliveries.state CHECK)
  UNASSIGNED · RIDER_SEARCHING · RIDER_ASSIGNED · RIDER_REASSIGNING
  AT_MERCHANT · PICKED_UP · EN_ROUTE · DELIVERED · FAILED · ABANDONED
        ↓
DESIGN EXPECTATION (brief §6: RIDER_ASSIGNED → PICKED_UP → IN_TRANSIT → ARRIVED → POD → DELIVERED)
        ↓
REQUIRED CHANGE: none to the state machine. The brief's chain uses three names
that do not exist (IN_TRANSIT, ARRIVED, POD) and omits one that does
(AT_MERCHANT). Mapped below.
```

| Brief's name | Repository's name | Status |
|---|---|---|
| `RIDER_ASSIGNED` | `RIDER_ASSIGNED` | **EXISTS** — `POST /rider/offers/:id/accept` |
| *(no equivalent in the brief)* | `AT_MERCHANT` | **EXISTS** — `POST /rider/deliveries/:id/arrived`. The brief omits it. |
| `PICKED_UP` | `PICKED_UP` | **EXISTS** — `POST /rider/deliveries/:id/picked-up` (joins `orders READY_FOR_PICKUP → PICKED_UP`) |
| `IN_TRANSIT` | **`EN_ROUTE`** | **EXISTS, RENAMED** — `POST /rider/deliveries/:id/en-route` (joins `orders PICKED_UP → DELIVERING`) |
| `ARRIVED` | **no server state** | **CONFLICT — resolved as a screen state.** `AT_MERCHANT` is arrival at the *shop*; there is no customer-arrival state and no endpoint would accept one. The rider stays `EN_ROUTE`. |
| `POD` | **no server state** | **CONFLICT — resolved as a client-only phase.** Capture, review and upload all happen on the device; abandoning leaves the delivery untouched. |
| `DELIVERED` | `DELIVERED` | **MISSING COMMAND.** State exists; endpoint does not. §8.1. |

Full mapping of the surviving chain, with the order domain alongside:

```
RIDER_ASSIGNED ──arrived──▶ AT_MERCHANT ──picked-up──▶ PICKED_UP ──en-route──▶ EN_ROUTE ──delivered──▶ DELIVERED
                                          (order: READY_FOR_PICKUP    (order: PICKED_UP      (order: DELIVERING
                                                  → PICKED_UP)               → DELIVERING)          → DELIVERED)
                                                                                            ▲
                            ┌───────────── client-only, no server state ────────────────────┘
                            ถึงจุดส่ง → ถ่ายรูป → ตรวจรูป → presign → PUT → (command)
```

`FAILED` exists in the schema, has **no endpoint and no approved copy**, and is
out of scope for both designs. `ABANDONED` likewise.

---

## 11. Implementation Roadmap

Every task states objective, files, dependencies, acceptance, risk, and whether
a migration or a live DB change is required. **No task in this roadmap requires
a migration or a live database change.**

### Phase 1 — Foundation (backend, no UI)

**T1.1 · The delivered command** — *the highest-value single task; do it first.*
- **Objective:** `POST /api/v1/rider/deliveries/:id/delivered`, `EN_ROUTE →
  DELIVERED`, joining `orders DELIVERING → DELIVERED`, with the assignment
  closed and the rider slot released. Accept `objectKey` as **optional** at
  this stage so the endpoint lands before POD-Q-01 is answered.
- **Files:** `apps/api/src/modules/rider/delivery-completion.service.ts` (new)
  + spec, `rider.controller.ts`, `rider.module.ts`,
  `packages/validation/src/rider.ts` (`RiderDeliveredResponse`, request schema).
- **Dependencies:** none. `OrdersService.completeDelivery` already exists.
- **Acceptance:** guarded UPDATE is the sole authority; winner-only history
  row; order half via the unmodified `OrdersService`; `rider_assignments →
  COMPLETED`; `active_delivery_count 1 → 0` under CAS; idempotent retry on an
  already-`DELIVERED` delivery returns success and writes **no** second history
  row; `409` when not `EN_ROUTE`; `403` for a non-assigned rider, indistinguishable
  from a non-existent delivery.
- **Risk:** **HIGH** — this is the one task that can silently brick riders
  (§5.1) and the one that touches two domains. Mitigate with the
  `DeliveryEnRouteService` template and explicit tests for the slot release.
- **Migration:** NO. **Live DB change:** NO.

**T1.2 · Provision R2, with a private bucket**
- **Objective:** create the R2 buckets and credentials; add
  `R2_PRIVATE_BUCKET` to `packages/config/src/env.ts` and `.env.example`.
- **Files:** `packages/config/src/env.ts` + spec, `.env.example`,
  deployment secrets.
- **Dependencies:** §15 D-3 (approval of the two-bucket model).
- **Acceptance:** the private bucket returns 403/404 for an unsigned GET at a
  known key, **verified by execution, not assumed**; the public bucket is
  unchanged; no credential appears in Git or in any client bundle.
- **Risk:** MEDIUM — a misconfigured public bucket is a privacy incident, not a
  broken image. This is the task that most deserves manual verification.
- **Migration:** NO. **Live DB change:** NO.

**T1.3 · Delivery-proof key builder and parser**
- **Objective:** `deliveryProofObjectKey(deliveryId, mimeType)` and
  `parseDeliveryProofObjectKey(key, expectedDeliveryId)`.
- **Files:** `apps/api/src/modules/storage/object-key.ts` + `object-key.spec.ts`.
- **Dependencies:** none.
- **Acceptance:** the parser rejects a foreign delivery id, a traversal
  attempt, an extra or missing segment, a leading/trailing slash, a query
  string, a non-UUID and a disallowed extension — each with a generic result.
- **Risk:** LOW. Third instance of an established pattern.
- **Migration:** NO.

**T1.4 · Private-object support + signed download on `StorageService`**
- **Objective:** a bucket-aware `StorageService`, plus
  `getSignedDownloadUrl(key, expiresInSeconds)`.
- **Files:** `apps/api/src/modules/storage/storage.service.ts` + spec.
- **Dependencies:** T1.2.
- **Acceptance:** no business module imports the S3 SDK; a proof key can never
  be passed to `getPublicUrl` (guard or type-level separation); signed URLs
  expire and are never logged.
- **Risk:** MEDIUM — changing a shared service used by two live merchant flows.
  Keep the existing method signatures working unchanged.
- **Migration:** NO.

**T1.5 · Proof presign endpoint** — `POST …/deliveries/:id/proof/upload-url`.
- **Files:** new `delivery-proof.service.ts` + spec, `rider.controller.ts`,
  `packages/validation/src/rider.ts`.
- **Dependencies:** T1.3, T1.4.
- **Acceptance:** refuses a delivery the caller is not assigned to and one that
  is not `EN_ROUTE`; the refusal does not reveal whether the id exists; the
  returned URL is scoped to exactly one object, one operation, one content type.
- **Risk:** LOW. **Migration:** NO.

**T1.6 · Wire `objectKey` into the delivered command**
- **Objective:** structural parse + `exists()` + a size ceiling from
  `HeadObject`, then the path written in the same guarded UPDATE.
- **Files:** `delivery-completion.service.ts`.
- **Dependencies:** T1.1, T1.3, T1.5. **Decision:** POD-Q-01 (mandatory or not).
- **Acceptance:** a fabricated key, a foreign key, a key with no object and an
  oversized object are each refused and **none of them moves any state**.
- **Risk:** MEDIUM. **Migration:** NO.

### Phase 2 — Driver UI

**T2.1 · Component library + tokens** — `StateCard`, `OfferCard`, `Countdown`,
`Toast`, `ConnectionBanner`, `EmptyState`, `ErrorState`, `ListRow`, `LivePill`;
delete `StatusStrip`; add the 16 tokens and the driver type scale; add
`Button size`.
- **Files:** `apps/driver/src/components/*`, `packages/ui/src/theme/tokens.ts`,
  `packages/ui/src/components/Button.tsx`.
- **Dependencies:** none.
- **Acceptance:** every colour in every frame resolves to a token, no hex is
  hard-coded in a component; **the customer app's rendering is unchanged**
  (its test suite passes untouched, and `Button`'s default size is today's).
- **Risk:** MEDIUM — `packages/ui` is shared. **Migration:** NO.

**T2.2 · Redesign the six existing screens** — presentation only.
- **Files:** `HomeScreen.tsx`, `StatusScreen.tsx`, `OfferInboxScreen.tsx`,
  `screens/auth/*.tsx`.
- **Dependencies:** T2.1.
- **Acceptance:** **the G7.1 suite A–S passes unmodified.** Every existing
  `testID` preserved verbatim. Specifically: zero on the countdown does not
  disable either action (Test I); no local list patching (M, H); no second
  timer, no background task, no Realtime (N, O, P); no toggle in the
  non-approved tree (B).
- **Risk:** **HIGH** — this is a refactor of the only screens currently under
  live acceptance. The four listed constraints are the whole risk.
- **Migration:** NO.

**T2.3 · Active-delivery screen (G-7.2)** — the four-step flow, reading
`deliveries` (id, state, order_id) under `deliveries_select_rider` plus
`rider_order_view` for the order detail.
- **Files:** `apps/driver/src/screens/ActiveDeliveryScreen.tsx`,
  `src/repositories/riderDelivery.ts`, `src/data/riderDeliveryQueries.ts`,
  `src/domain/riderDelivery.ts`, `navigation/*`, plus the first consumer of the
  built-and-unused `RiderOrderViewRepository`.
- **Dependencies:** T1.1 (the delivered command must exist, or step 4 dead-ends).
- **Acceptance:** the correct step is restored after an app restart from server
  state alone; each transition calls the existing endpoint; a `409` is reported,
  never worked around.
- **Risk:** MEDIUM. **Migration:** NO.

**T2.4 · Home offer count (DG-05)** — one focus-only read, no timer.
- **Dependencies:** decision D-1 in §15. **Risk:** LOW. **Migration:** NO.

### Phase 3 — POD

**T3.1 · Camera capability** — add the package and both permission
declarations, with Thai usage strings matching the location string's tone.
- **Files:** `apps/driver/package.json`, `apps/driver/app.json`.
- **Acceptance:** iOS and Android builds produce the permission prompt; the
  strings are Thai and say what the photo is for.
- **Risk:** LOW mechanically; **the one task that requires a real device**
  (the Simulator's camera is not representative).
- **Migration:** NO.

**T3.2 · Capture, review and compression** — P-02 through P-05 and P-10, plus
resize/re-encode to ~1600 px / q0.7, which also strips EXIF (§5.5, §5.6).
- **Dependencies:** T2.3, T3.1.
- **Acceptance:** unlimited retakes discard cleanly; a zero-byte or unreadable
  capture never advances to review; the produced file is under the size
  ceiling and carries no GPS EXIF (**assert this in a test**); every permission
  refusal path ends on a screen with a route forward and the delivery still open.
- **Risk:** MEDIUM. **Migration:** NO.

**T3.3 · Confirm, upload, command, retry** — P-06 through P-09.
- **Dependencies:** T1.5, T1.6, T3.2.
- **Acceptance:** `ส่งสำเร็จ` appears **only** after a 200 — verified by forcing
  a failure at each of the three stages; the local URI and delivery id survive
  an app kill; a retry after a successful upload sends the command alone and
  does not re-upload; no background task, no queued completion; on success the
  stack **resets** to Home so back cannot return to a closed delivery.
- **Risk:** **HIGH** — the most failure-mode-dense screen in the product, and
  the one where a wrong answer tells a rider a delivery closed when it did not.
- **Migration:** NO.

**T3.4 · Customer proof read** — `GET /api/v1/orders/:id/delivery-proof`, the
C-19 card, the C-19b viewer, the C-19c empty card, the C-14 row.
- **Files:** `apps/api/src/modules/orders/delivery-proof.{controller,service}.ts`,
  `apps/customer/src/repositories/apiDeliveryProof.ts`,
  `OrderDetailScreen.tsx`, `OrderTrackingScreen.tsx`, a new `ProofViewer` route.
- **Dependencies:** T1.4.
- **Acceptance:** the order's own customer sees the photo and both timestamps
  and **no rider identity**; any other account is refused; an expired link
  re-mints on reopen rather than failing; a delivered order with a null path
  renders C-19c, not a hidden section or a broken image.
- **Risk:** MEDIUM. **Migration:** NO.

### Phase 4 — Verification

**T4.1** Unit tests — key builder/parser (every rejection case), completion
service (guard, repair, slot release, assignment close), storage service
(signed download, bucket separation).
**T4.2** Repository/hook tests — driver delivery repository column list (assert
it never selects a money column), customer proof repository.
**T4.3** API tests — all 14 acceptance criteria from POD §K, driven through
the controllers.
**T4.4** RLS tests — extend `supabase/tests/` (**read-only additions to the
test suite; no schema change**): a foreign rider cannot read another's
delivery row; a customer cannot write `deliveries`; `rider_order_view` still
projects no money column.
**T4.5** Integration — the full `RIDER_ASSIGNED → DELIVERED` chain against the
Docker Postgres suite, plus a genuinely concurrent double-`delivered` proving
one history row.
**T4.6** Real-device acceptance — camera permission on both platforms, a real
low-signal upload, an app kill mid-flow, and the **Android font/permission
check that is still `UNVERIFIED` repo-wide**.
**T4.7** G7.1 regression — the full A–S suite after T2.2, unmodified.

---

## 12. Test Strategy

| Layer | What it must prove | Where |
|---|---|---|
| Unit (API) | Every key-shape rejection; the guarded UPDATE is the sole authority; the repair path never re-decides; the slot CAS runs exactly once | `apps/api/src/modules/**/*.spec.ts` |
| Unit (mobile) | Countdown derives from `expires_at` alone; no component hard-codes a hex; the delivery repository's column list | `apps/driver/src/**/*.test.ts(x)` |
| Repository/data | Every driver query's selected column list is asserted explicitly — the existing suite already does this for `active_delivery_count`, and the new delivery query must follow it | `apps/driver/src/repositories/*.test.ts` |
| API integration | POD §K criteria 1–14, end to end | new `*.spec.ts` under `modules/rider` and `modules/orders` |
| RLS (SQL) | Foreign-rider isolation on `deliveries`; no client write path; view column lists unchanged | `supabase/tests/*.sql` via `run-domain-tests.sh` |
| Concurrency | Two simultaneous `delivered` calls → one winner, one history row, one slot release | Docker `psql`, following `rider_race_*.sql`'s precedent of proving by execution |
| Device | Camera permission (both platforms), real upload on poor signal, app kill mid-flow, Android font rendering | manual, screenshot-evidenced per the house rule |
| Regression | G7.1 A–S unmodified after the redesign | existing acceptance suite |

House rules that apply: never mark a screen `MATCH` without a screenshot;
`UNVERIFIED` is an acceptable answer and a false `MATCH` is not; prove
concurrency by execution rather than by reasoning.

---

## 13. Cost / Infrastructure Considerations

**Nothing new is needed.** No Cloudflare Workers, no external CDN, no image
processing API, no additional database, no queue.

| Choice | Why |
|---|---|
| R2, not Supabase Storage | Already integrated, already the provider boundary, zero egress fees. Adding Supabase Storage would mean two storage providers for one feature. |
| A second **private** R2 bucket | Free (R2 bills bytes and operations, not buckets) and makes privacy structural. |
| **Client-side** compression | Free, and it is also the correct place: it shrinks the upload the rider actually pays for in time and data at a doorway with poor signal. Server-side processing would mean bytes transiting Cloud Run — which the presign pattern exists precisely to avoid — plus CPU cost and a new dependency. |
| Presign, not proxy | Image bytes never touch Cloud Run; no request-size limits, no memory pressure, no bandwidth cost. |
| Polling, not Realtime | TQ-002 is `OPEN` and enabling Realtime on `rider_assignment_attempts` is a migration against a locked schema. The 15 s foreground poll costs nothing extra. |
| No analytics pipeline | None exists. `delivery_status_history` already answers the operational question ("when did this complete, and who moved it"). |

Storage volume at development stage is negligible: at ~400 KB per compressed
proof, ten thousand deliveries is ~4 GB — within R2's free tier.

---

## 14. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | The delivered command omits the `active_delivery_count` reset, silently bricking every rider after their first delivery | **CRITICAL** | §5.1. Explicit test asserting the CAS; the dispatcher's `= 0` requirement makes the failure invisible without one. |
| R-2 | POD objects land in the public bucket | **CRITICAL** | §7.3 two-bucket model, verified by an unsigned GET returning 403/404 **by execution**. |
| R-3 | The driver redesign breaks one of the G7.1 A–S tests | **HIGH** | The four named constraints (§4, D-7/8/9/10). Run the suite unmodified before and after T2.2. |
| R-4 | The rider is told a delivery closed when it did not | **HIGH** | `ส่งสำเร็จ` only after a 200; failure at each of three stages tested by forced failure. |
| R-5 | Uncompressed uploads fail on rural mobile data | **HIGH** | Client-side resize (§5.5) plus a server-side size ceiling. |
| R-6 | EXIF GPS leaks the rider's or customer's location into a downloadable object | **MEDIUM** | Re-encode strips EXIF; assert it in a test rather than relying on it as a side effect. |
| R-7 | Partial failure between the delivery write and the order write | **MEDIUM** | The established repair-on-retry path; `DeliveryEnRouteService` is the template and documents the reasoning fully. |
| R-8 | Photos accumulate indefinitely with no lawful-basis or retention decision (PDPA) | **MEDIUM / LEGAL** | POD-Q-04, Q-012. Specify the purge mechanism **before** the first photo is stored, not after. |
| R-9 | Changing shared `packages/ui` regresses the customer app | **MEDIUM** | Additive tokens only; `Button`'s default size unchanged; the customer suite passes untouched. |
| R-10 | R2 has never been exercised against a real bucket | **MEDIUM** | T1.2 is a provisioning-and-verification task in its own right, not a side effect of another task. |
| R-11 | Camera behaviour is unverifiable on the Simulator, and Android is `UNVERIFIED` repo-wide | **MEDIUM** | T4.6 requires real devices on both platforms. Do not claim POD works before it runs on hardware. |
| R-12 | POD-Q-02 unanswered ships a rider who genuinely cannot photograph into a dead end | **MEDIUM** | The frames say `ติดต่อผู้ดูแล` and stop. If the photo is mandatory, this rider cannot close a delivery they actually completed. Needs a PO answer before POD-Q-01 resolves to "mandatory". |
| R-13 | `CLAUDE.md` is stale and could misdirect a future agent into re-doing merged work | **LOW / process** | §15 D-7. |

---

## 15. Decisions Required

| ID | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D-1** | POD-Q-01 — is the proof photo mandatory? | The confirm screen only | **Mandatory.** With COD disabled (DEC-016) the photo is the only evidence a handover happened, which `RIDER_LIFECYCLE.md` §10 says raises its importance. Answer D-2 first. |
| **D-2** | POD-Q-02 — what does a rider who genuinely cannot photograph do? | An escape path | Needs a real answer before D-1 can be "mandatory". The operator force-unassign path is for a rider who did *not* deliver — using it here would write an untrue record. |
| **D-3** | The two-bucket model (§7.3) | T1.2, T1.4 | **Adopt.** Free, simple, makes the privacy property structural. This plan's one addition to the design. |
| **D-4** | POD-Q-04 / Q-012 — retention and PDPA lawful basis | Nothing technically; everything legally | Specify the purge mechanism before the first photo is stored. Currently "kept indefinitely" by default, which is what building nothing produces. |
| **D-5** | DG-05 — is a one-shot read on Home focus within polling policy? | The Home offer badge only | Yes, with no timer. It is the same shape as the existing profile read. |
| **D-6** | The icon set (both designs) | Nothing; it is drawn with emoji today | Commission it as a small separate piece of design work. Emoji render per-OEM on Android. |
| **D-7** | Reconcile `CLAUDE.md` with reality | Nothing; a correctness risk for future agents | Update §3, §4, §5 and §9 to reflect 19 migrations and merged Phases E/F/G. |
| **D-8** | POD-Q-03 (stored capture time), POD-Q-05 (merchant visibility), POD-Q-06 (customer notification), POD-Q-07 (DB immutability) | Nothing | Accept the design's stated interim positions. All four are deferrable; three would need a migration. |
| **D-9** | DG-02 / BQ-029 — rider earnings | No rider money surface can exist | Out of scope here. Show no money anywhere — not a zero, not a dash. |

---

## 16. Requirement Table

| Requirement | Current State | Gap | Files | DB Change | API Change | Mobile Change | Risk |
|---|---|---|---|---|---|---|---|
| Store a proof photo path | `deliveries.proof_photo_path` exists | — | — | NO | NO | NO | — |
| `DELIVERED` delivery state | Exists in CHECK | — | — | NO | NO | NO | — |
| Order `DELIVERING → DELIVERED` | `OrdersService.completeDelivery`, **no caller** | Wire it | `orders.service.ts` (unmodified) | NO | YES | NO | LOW |
| `delivered` rider command | **MISSING** | Build | `delivery-completion.service.ts`, `rider.controller.ts`, `rider.module.ts`, `validation/rider.ts` | NO | YES | YES | **HIGH** |
| Rider slot release on completion | **MISSING** | Build into the command tail | `delivery-completion.service.ts` | NO | YES | NO | **CRITICAL** |
| Close `rider_assignments` as `COMPLETED` | **MISSING** | Build (plain guarded UPDATE, **not** the RPC) | `delivery-completion.service.ts` | NO | YES | NO | MEDIUM |
| Proof presign endpoint | **MISSING**; pattern exists twice | Build | `delivery-proof.service.ts`, `rider.controller.ts` | NO | YES | YES | LOW |
| Proof key builder + parser | **MISSING**; named in `object-key.ts` | Build | `storage/object-key.ts` | NO | YES | NO | LOW |
| Signed **download** URL | **MISSING** on `StorageService` | Build | `storage/storage.service.ts` | NO | YES | NO | MEDIUM |
| Private storage bucket | **MISSING** — single public bucket configured | Provision + config | `packages/config/src/env.ts`, `.env.example` | NO | YES | NO | **CRITICAL** |
| R2 provisioned at all | **NOT PROVISIONED** | Provision + verify | deployment secrets | NO | NO | NO | MEDIUM |
| Image compression before upload | **MISSING** everywhere in the repo | Build | driver POD screens | NO | NO | YES | HIGH |
| EXIF stripping | **MISSING** | Build (via re-encode) + test | driver POD screens | NO | NO | YES | MEDIUM |
| File-size limit | **MISSING** | Build (`HeadObject` size check) | `delivery-completion.service.ts` | NO | YES | YES | MEDIUM |
| Camera capability | **MISSING** — no package, no permissions | Add | `apps/driver/package.json`, `app.json` | NO | NO | YES | LOW |
| Active-delivery screen | **MISSING** (G-7.2) | Build | `apps/driver/src/screens/`, repositories, navigation | NO | NO | YES | MEDIUM |
| Rider delivery-state read path | **PARTIAL** — `rider_order_view` has no delivery id/state | Read `deliveries` under existing `deliveries_select_rider` | `apps/driver/src/data/`, `repositories/` | NO | NO | YES | LOW |
| Customer proof read | **MISSING** — no customer screen reads `deliveries` | Build endpoint + repository + card | `orders/delivery-proof.*`, `apiDeliveryProof.ts`, `OrderDetailScreen.tsx`, `OrderTrackingScreen.tsx` | NO | YES | YES | MEDIUM |
| Full-screen proof viewer | **MISSING** | Build | new `ProofViewer` route | NO | NO | YES | LOW |
| "No proof" state (legacy orders) | **MISSING** | Build (C-19c) | `OrderDetailScreen.tsx` | NO | NO | YES | LOW |
| `StateCard` / `OfferCard` / `Countdown` / `Toast` etc. | **MISSING** | Build; delete `StatusStrip` | `apps/driver/src/components/` | NO | NO | YES | MEDIUM |
| 16 new semantic tokens + type scale | **PARTIAL** | Add (strictly additive) | `packages/ui/src/theme/tokens.ts` | NO | NO | YES | MEDIUM |
| `Button` `size` prop | **PARTIAL** | Add | `packages/ui/src/components/Button.tsx` | NO | NO | YES | MEDIUM |
| Polling semantics preserved | **EXISTS** | Must not change | `hooks/useRiderOfferInbox.ts` | NO | NO | NO | **HIGH** (regression) |
| Zero countdown stays actionable | **EXISTS** | Must not change | `OfferInboxScreen.tsx` | NO | NO | NO | **HIGH** (regression) |
| Approval gate (absent, not disabled) | **EXISTS** | Must not change | `HomeScreen.tsx`, `StatusScreen.tsx` | NO | NO | NO | HIGH (regression) |
| Home offer count badge | **MISSING** (DG-05) | Focus-only read | `HomeScreen.tsx` | NO | NO | YES | LOW |
| Restaurant/address on the offer card | **CONFLICT — privacy boundary** | Do not build | — | NO | NO | NO | — |
| Rider earnings anywhere | **NEEDS_DECISION** (BQ-029) | Do not build | — | NO | NO | NO | — |
| Push notification of an offer | **MISSING** (TQ-002 `OPEN`) | Do not build | — | NO | NO | NO | — |
| Retention / purge | **MISSING — NEEDS_DECISION** | Specify before first photo stored | — | (likely YES later) | YES later | NO | MEDIUM/LEGAL |
| Merchant proof visibility | **NEEDS_DECISION** (POD-Q-05) | Not in V1 | — | NO | NO | NO | — |
| Multiple photos / signature / OTP | **Out of scope by design** | Do not build | — | NO | NO | NO | — |
| `FAILED` delivery path | **MISSING** — state exists, no endpoint, no copy | Out of scope | — | NO | NO | NO | — |

---

## 17. Final Recommendation

**Proceed, in three stages, in this order.**

**Stage 1 — ship the delivered command on its own (T1.1).** It is independent
of every POD decision, it is the endpoint that currently dead-ends the driver
app's active-delivery flow, and its order-side half is already written and
waiting for a caller. It is also the task carrying the critical
`active_delivery_count` hazard, which deserves undivided attention rather than
being buried inside a POD slice. Do not bundle it with anything.

**Stage 2 — build the active-delivery screen (T2.3) and the driver redesign
(T2.1–T2.2).** These are independent of each other and of POD. The redesign's
only real risk is regression against the G7.1 A–S suite, and that suite exists
and passes today, so the risk is measurable rather than speculative. Reading
`deliveries` under the existing `deliveries_select_rider` policy closes DG-04's
read-path half with no migration and no new view — the recommended route.

**Stage 3 — POD (T1.2–T1.6, T3.x, T3.4)**, once D-1, D-2 and D-3 are answered.
The design is sound, the schema is ready, the storage pattern is established
twice, and the additions this analysis makes are two: **a private bucket**, and
**client-side compression that also strips EXIF**. Neither is a departure from
the design's intent; both are things it did not surface.

Two things should be resolved before the first photo is ever stored, not after:
**the private bucket** (a public one makes the entire signed-URL design
decorative) and **the retention answer** (a proof photo is personal data under
PDPA, and no purge mechanism exists anywhere in this system).

**Nothing in this plan requires a migration, a schema change, or a live
database change.** The one hard-locked constraint the schema places on POD —
that no new delivery state may be added — turned out to be the right design
anyway.

---

## 18. Safety Report

```text
SOURCE_FILES_CHANGED: docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md only
SCHEMA_CHANGED: NO
LIVE_DATA_MODIFIED: NO
PRODUCTION_TOUCHED: NO
CREDENTIALS_EXPOSED: NO
MIGRATIONS_CREATED: NO
COMMIT: NO
PUSH: NO
```

Repository inspection was read-only throughout: `ls`, `find`, `cat`, `sed -n`,
`grep`, and offline HTML text extraction of the two design artifacts into the
session scratchpad. No `psql`, no `supabase` CLI, no network call, no bucket
operation, no test user, no SQL mutation. No secret value was read or printed —
only the *names* of environment variables from `.env.example` and
`packages/config/src/env.ts`, both of which are committed and contain no values.
