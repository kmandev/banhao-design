/**
 * Route map for the Driver App.
 *
 * Route names mirror the rider screen ids in
 * `docs/design/BANHAO-UX-DESIGN-HANDOFF-V1.md` §8 so a screen can be traced
 * from the handoff to code without guesswork:
 *
 *   R-01 เข้าสู่ระบบ            → `Login` / `Otp`
 *   R-02 สถานะการตรวจสอบ        → rendered by `Home` as the approval gate
 *   R-03 หน้าหลัก               → `Home`
 *   R-04 เปิด/ปิดรับงาน          → the control on `Home`
 *
 * R-05 (offer) is `OfferInbox` — G-7.1. R-06 (งานที่กำลังทำ) is now
 * `ActiveDelivery` — G-7.2 Phase 1, which folds to-restaurant, arrival,
 * pickup, departure and handoff into ONE screen driven by the delivery's own
 * server state rather than five routes. Five separate routes would each have
 * to re-derive which step the rider is on; one screen reads it once.
 *
 * `ProofCamera`, `ProofReview` and `DeliveryConfirm` are the POD leg
 * (G-7.2 Phase 2), pushed above `ActiveDelivery`. Each carries the
 * `deliveryId` it acts on, and the last two also the prepared local photo —
 * see the note on `ProofCamera` for why the photo travels as a route param.
 *
 * There is no tab navigator yet. The handoff's 4-tab bar
 * (หน้าหลัก · งานของฉัน · รายได้ · บัญชี) needs งานของฉัน (G-7.2) and รายได้
 * (BQ-029, `OPEN`) to have anything behind them, and DEC-UX-006 hides the bar
 * during a job anyway. One stack is the honest shape of this slice.
 */

import type { PreparedProofPhoto } from '../lib/proofPhoto';

export type AuthStackParamList = {
  Login: undefined;
  Otp: { phone: string };
};

export type RiderStackParamList = {
  Home: undefined;
  OfferInbox: undefined;
  /**
   * No `deliveryId` parameter, deliberately. The screen reads *the* active
   * delivery from `deliveries` under `deliveries_select_rider`, and DEC-037
   * limits a rider to one at a time — so an id in the route would be a second,
   * staleable source of truth for something the server already answers
   * unambiguously, and a rider returning from a completed delivery would carry
   * a dead id back into the screen.
   */
  ActiveDelivery: undefined;

  /**
   * The POD leg — POD UX design §E.
   *
   * These three DO carry `deliveryId`, unlike `ActiveDelivery`, and for the
   * opposite reason: they are pushed *from* a screen that has already resolved
   * which delivery is active, so re-reading it on each would be three extra
   * round trips to answer a question already answered. The server re-checks
   * ownership and state on every call regardless, so a stale id here is
   * refused rather than trusted.
   *
   * `photo` travels as a route param rather than through a store because it is
   * a local `file://` URI plus its metadata — small, plain, and meaningful
   * only for the duration of this stack. It never contains image bytes.
   */
  ProofCamera: { deliveryId: string };
  ProofReview: { deliveryId: string; photo: PreparedProofPhoto };
  DeliveryConfirm: { deliveryId: string; photo: PreparedProofPhoto };
};
