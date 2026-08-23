import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomBar, Button, StateView } from '@banhao/ui';
import { Screen } from '../components/Screen';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 13 สั่งสำเร็จ.
 *
 * This legacy confirmation route receives no real order UUID from the payment
 * flow. Its former tracking CTA sent a mock state to C-14, which cannot meet
 * the tracking read contract; C-16 now provides the real UUID path instead.
 */
export function OrderConfirmedScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-order-confirmed"
      footer={
        <BottomBar>
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
