import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomBar, Button, StateView } from '@banhao/ui';
import { Screen } from '../components/Screen';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type ConfirmedRoute = RouteProp<CustomerStackParamList, 'OrderConfirmed'>;

/**
 * 13 สั่งสำเร็จ.
 *
 * ## The tracking action is conditional, and that is the design
 *
 * `ติดตามออเดอร์` → C-14 is what the design canvas's own `isConfirm` block
 * specifies (`docs/design/BANHAO Customer App.dc.html`, `onClick="{{ goTrack }}"`),
 * and UX-SPEC §5 restates it: *"C-13 confirms with the order reference and a
 * single primary action into tracking."* It was removed in E-3D only because
 * the payment chain dropped the real order id and the only thing left to pass
 * was a fabricated state. E-3E threads the real id through, so the action is
 * restored against the real order — not re-designed.
 *
 * It is still withheld when no id arrives. The CASH path reaches this screen
 * without creating an order at all (DEC-016 keeps `POST /orders` to `ONLINE`),
 * so there is genuinely nothing to track; `OrderTracking` requires a real
 * UUID, and inventing one to keep a button on screen would produce a
 * guaranteed not-found. Showing no action is the honest outcome, and matches
 * how `OrdersScreen` withholds a badge with no approved copy.
 */
export function OrderConfirmedScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<ConfirmedRoute>();

  // Checked for real content, not mere presence: an empty or whitespace-only
  // param is not an order id, and must not put a button on screen that can
  // only fail. `orderNumber` is deliberately not consulted — C-14 reads by id.
  const orderId = params?.orderId;
  const trackableOrderId =
    typeof orderId === 'string' && orderId.trim().length > 0 ? orderId.trim() : undefined;

  return (
    <Screen
      testID="screen-order-confirmed"
      footer={
        <BottomBar>
          {trackableOrderId ? (
            <Button
              label="ติดตามออเดอร์"
              onPress={() => navigation.navigate('OrderTracking', { orderId: trackableOrderId })}
              testID="button-track-order"
            />
          ) : null}
          <Button label="กลับหน้าแรก" variant="ghost" onPress={() => navigation.navigate('Tabs')} />
        </BottomBar>
      }
    >
      <StateView
        kind="success"
        glyph="🎉"
        title="สั่งสำเร็จแล้ว"
        message="ส่งออเดอร์ให้ร้านแล้ว ร้านจะกดรับภายใน 3 นาที"
        testID="state-order-confirmed"
      />
    </Screen>
  );
}
