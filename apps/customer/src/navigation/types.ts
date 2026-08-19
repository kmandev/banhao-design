import type { OrderState } from '../mocks/types';

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
  // after a real POST /orders success, so the response is representable
  // without requiring every existing navigate('PromptPayQr') call site
  // (payment.tsx's own retry buttons) to start supplying them. Nothing reads
  // them yet — rendering an order reference is payment/tracking work
  // (Phase F / E-3B), out of scope here.
  PromptPayQr: { orderId?: string; orderNumber?: string } | undefined;
  PayChecking: undefined;
  PaySuccess: undefined;
  PayFailed: undefined;
  PayExpired: undefined;
  PayDuplicate: undefined;
  PayDetail: undefined;
  Refund: undefined;

  OrderConfirmed: undefined;
  /** `state` drives the 🛵 ไม่มีไรเดอร์ and 🚫 ยกเลิก variants. */
  OrderTracking: { orderId?: string; state?: OrderState };
  Rating: { orderId?: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends CustomerStackParamList {}
  }
}
