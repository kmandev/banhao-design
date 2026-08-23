import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  fontFamily,
  fontSize,
  sizes,
} from '@banhao/ui';
import { useAuth } from '../hooks/useAuth';
import type { AuthStackParamList, CustomerStackParamList, CustomerTabParamList } from './types';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';

import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ShopScreen } from '../screens/ShopScreen';
import { ItemOptionsScreen } from '../screens/ItemOptionsScreen';
import { CartScreen } from '../screens/CartScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { AddressScreen } from '../screens/AddressScreen';
import { AddressFormScreen } from '../screens/AddressFormScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { OrderConfirmedScreen } from '../screens/OrderConfirmedScreen';
import { OrderTrackingScreen } from '../screens/OrderTrackingScreen';
import { OrderDetailScreen } from '../screens/OrderDetailScreen';
import { RatingScreen } from '../screens/RatingScreen';
import {
  PromptPayQrScreen,
  PayCheckingScreen,
  PaySuccessScreen,
  PayFailedScreen,
  PayExpiredScreen,
  PayDuplicateScreen,
  PayDetailScreen,
  RefundScreen,
} from '../screens/payment';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const CustomerStack = createNativeStackNavigator<CustomerStackParamList>();
const Tabs = createBottomTabNavigator<CustomerTabParamList>();

/** Tab bar icons, exactly as the design defines them. */
const TAB_ICONS: Record<keyof CustomerTabParamList, string> = {
  Home: '🏠',
  Orders: '🧾',
  Notifications: '🔔',
  Profile: '👤',
};

const TAB_LABELS: Record<keyof CustomerTabParamList, string> = {
  Home: 'หน้าแรก',
  Orders: 'ออเดอร์',
  Notifications: 'แจ้งเตือน',
  Profile: 'บัญชี',
};

function TabIcon({ route, focused }: { route: keyof CustomerTabParamList; focused: boolean }) {
  return (
    <View style={styles.tabItem}>
      <Text style={styles.tabIcon}>{TAB_ICONS[route]}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{TAB_LABELS[route]}</Text>
    </View>
  );
}

/** The design's 4-tab bar: หน้าแรก · ออเดอร์ · แจ้งเตือน · บัญชี. */
function CustomerTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: styles.tabBar,
        tabBarIcon: ({ focused }) => (
          <TabIcon route={route.name as keyof CustomerTabParamList} focused={focused} />
        ),
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ title: TAB_LABELS.Home }} />
      <Tabs.Screen name="Orders" component={OrdersScreen} options={{ title: TAB_LABELS.Orders }} />
      <Tabs.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: TAB_LABELS.Notifications }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: TAB_LABELS.Profile }}
      />
    </Tabs.Navigator>
  );
}

/** Exported so the Thai back label can be asserted without driving the header. */
export const headerOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontSize: fontSize.xl, fontFamily: fontFamily.semibold },
  headerShadowVisible: false,
  // Without this the back button falls back to the previous route's name —
  // which surfaced as "Tabs" — or to iOS's generic English "Back" when the
  // previous title is too long. Neither belongs in a Thai-language app.
  headerBackTitle: 'กลับ',
  headerBackTitleStyle: { fontSize: fontSize.md, fontFamily: fontFamily.regular },
} as const;

function CustomerNavigator() {
  return (
    <CustomerStack.Navigator screenOptions={headerOptions}>
      <CustomerStack.Screen name="Tabs" component={CustomerTabs} options={{ headerShown: false }} />
      <CustomerStack.Screen name="Search" component={SearchScreen} options={{ title: 'ค้นหา' }} />
      <CustomerStack.Screen name="Shop" component={ShopScreen} options={{ title: 'หน้าร้าน' }} />
      <CustomerStack.Screen
        name="ItemOptions"
        component={ItemOptionsScreen}
        options={{ title: 'เลือกตัวเลือกอาหาร' }}
      />
      <CustomerStack.Screen name="Cart" component={CartScreen} options={{ title: 'ตะกร้า' }} />
      <CustomerStack.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{ title: 'ยืนยันการสั่ง' }}
      />
      <CustomerStack.Screen
        name="Address"
        component={AddressScreen}
        options={{ title: 'ที่อยู่จัดส่ง' }}
      />
      <CustomerStack.Screen
        name="AddressForm"
        component={AddressFormScreen}
        options={{ title: 'เพิ่มที่อยู่ใหม่' }}
      />

      <CustomerStack.Screen
        name="PromptPayQr"
        component={PromptPayQrScreen}
        options={{ title: 'พร้อมเพย์ QR' }}
      />
      <CustomerStack.Screen
        name="PayChecking"
        component={PayCheckingScreen}
        options={{ title: 'กำลังตรวจสอบ' }}
      />
      <CustomerStack.Screen
        name="PaySuccess"
        component={PaySuccessScreen}
        options={{ title: 'ชำระสำเร็จ' }}
      />
      <CustomerStack.Screen
        name="PayFailed"
        component={PayFailedScreen}
        options={{ title: 'ยืนยันไม่ได้' }}
      />
      <CustomerStack.Screen
        name="PayExpired"
        component={PayExpiredScreen}
        options={{ title: 'QR หมดอายุ' }}
      />
      <CustomerStack.Screen
        name="PayDuplicate"
        component={PayDuplicateScreen}
        options={{ title: 'จ่ายซ้ำ / จ่ายแล้ว' }}
      />
      <CustomerStack.Screen
        name="PayDetail"
        component={PayDetailScreen}
        options={{ title: 'รายละเอียดการจ่าย' }}
      />
      <CustomerStack.Screen name="Refund" component={RefundScreen} options={{ title: 'การคืนเงิน' }} />

      <CustomerStack.Screen
        name="OrderConfirmed"
        component={OrderConfirmedScreen}
        options={{ title: 'สั่งสำเร็จ', headerBackVisible: false }}
      />
      <CustomerStack.Screen
        name="OrderTracking"
        component={OrderTrackingScreen}
        options={{ title: 'ติดตามออเดอร์' }}
      />
      <CustomerStack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{ title: 'รายละเอียดออเดอร์' }}
      />
      <CustomerStack.Screen name="Rating" component={RatingScreen} options={{ title: 'ให้คะแนน' }} />
    </CustomerStack.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Otp" component={OtpScreen} />
    </AuthStack.Navigator>
  );
}

/**
 * Chooses the authenticated or unauthenticated tree.
 *
 * While the persisted session is being read we show screen 01 (Splash), which
 * is exactly the role the design gives it.
 */
export function RootNavigator() {
  const { initialising, session } = useAuth();

  if (initialising) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      {session ? <CustomerNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: sizes.tabBarHeight + 24,
    paddingTop: 6,
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
  },
  tabItem: { alignItems: 'center', gap: 3, width: 72 },
  tabIcon: { fontFamily: fontFamily.regular, fontSize: 20 },
  tabLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textFaint },
  tabLabelActive: { color: colors.primary, fontFamily: fontFamily.semibold },
});
