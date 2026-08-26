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
 * R-05 (offer) is now `OfferInbox` — G-7.1. Offer lost, to-restaurant,
 * arrived, pickup, to-customer, handoff remain **not** routes here: they are
 * G-7.2, and adding empty routes for them now would claim screens that do not
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
};
