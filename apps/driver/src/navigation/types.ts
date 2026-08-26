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
 * The POD camera, review and confirm routes the POD UX design specifies
 * (`ProofCamera`, `ProofReview`, `DeliveryConfirm`) are **not** here: POD is
 * the next phase, and an empty route would claim a screen that does not
 * exist.
 *
 * There is no tab navigator yet. The handoff's 4-tab bar
 * (หน้าหลัก · งานของฉัน · รายได้ · บัญชี) needs งานของฉัน (G-7.2) and รายได้
 * (BQ-029, `OPEN`) to have anything behind them, and DEC-UX-006 hides the bar
 * during a job anyway. One stack is the honest shape of this slice.
 */

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
};
