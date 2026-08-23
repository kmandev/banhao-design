/**
 * Route map for the Customer App.
 *
 * Route names mirror the design's own screen ids where practical, so a screen
 * can be traced from docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md to code without
 * guesswork.
 */

export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Login: undefined;
  Otp: { phone: string };
};

export type CustomerTabParamList = {
  Home: undefined;
  Orders: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type CustomerStackParamList = {
  Tabs: undefined;
  Search: undefined;
  /** `closed` renders the 🌙 ร้านปิด state variant. */
  Shop: { shopId: string };
  ItemOptions: { shopId: string; itemId: string };
  Cart: undefined;
  Checkout: undefined;
  Address: undefined;

  // Payment screens. No provider is integrated (Q-001 OPEN, DEC-015) — these
  // render payment states from local state only.
  //
  // orderId/orderNumber are optional (Phase E-3A): CheckoutScreen passes them
  // after a real POST /orders success. Phase E-3E threads them along the
  // ONLINE chain that already existed — PromptPayQr → PayChecking →
  // PaySuccess/PayDuplicate → OrderConfirmed — so C-13 can offer the design's
  // own `ติดตามออเดอร์` action against the real order. They stay OPTIONAL
  // because two callers legitimately have no order to name: the CASH path
  // reaches OrderConfirmed without one (DEC-016 keeps order creation to
  // ONLINE), and payment.tsx's own retry buttons re-enter PromptPayQr without
  // one. A screen that has no id renders no order reference — it never
  // invents one.
  //
  // PayFailed/PayExpired are deliberately NOT widened: both exist only to
  // route back into a retry, and whether a retry reuses the existing order or
  // creates a new one is an unanswered idempotency question (REQ-003). Giving
  // them an id they cannot yet use correctly would prejudge it.
  PromptPayQr: { orderId?: string; orderNumber?: string } | undefined;
  PayChecking: { orderId?: string; orderNumber?: string } | undefined;
  PaySuccess: { orderId?: string; orderNumber?: string } | undefined;
  PayFailed: undefined;
  PayExpired: undefined;
  PayDuplicate: { orderId?: string; orderNumber?: string } | undefined;
  PayDetail: undefined;
  Refund: undefined;

  /**
   * 13 สั่งสำเร็จ. `orderId` is present only for a real ONLINE order; the CASH
   * path still arrives with nothing, and C-13 then shows no tracking action.
   */
  OrderConfirmed: { orderId?: string; orderNumber?: string } | undefined;
  /**
   * C-14 reads a single order directly from Supabase under customer RLS.
   * This UUID drives the read; the screen gets its state and history from the
   * RLS-scoped response rather than route parameters.
   */
  OrderTracking: { orderId: string };
  /**
   * Real order detail (Phase E-3B.1) — items, options, money and status
   * history read live from Supabase. C-16 opens C-14 for an in-flight order
   * and retains this C-19 route for delivered/history orders.
   */
  OrderDetail: { orderId: string };
  Rating: { orderId?: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends CustomerStackParamList {}
  }
}
