import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors, fontFamily, fontSize } from '@banhao/ui';
import { useAuth } from '../hooks/useAuth';
import type { AuthStackParamList, RiderStackParamList } from './types';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { OfferInboxScreen } from '../screens/OfferInboxScreen';
import { ActiveDeliveryScreen } from '../screens/ActiveDeliveryScreen';
import { ProofCameraScreen } from '../screens/ProofCameraScreen';
import { ProofReviewScreen } from '../screens/ProofReviewScreen';
import { DeliveryConfirmScreen } from '../screens/DeliveryConfirmScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const RiderStack = createNativeStackNavigator<RiderStackParamList>();

/** Exported so the Thai back label can be asserted without driving the header. */
export const headerOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontSize: fontSize.xl, fontFamily: fontFamily.semibold },
  headerShadowVisible: false,
  // Same fix as the Customer App's DEF-03: without this the back button falls
  // back to the previous route's name or to iOS's generic English "Back",
  // neither of which belongs in a Thai-language app.
  headerBackTitle: 'กลับ',
  headerBackTitleStyle: { fontSize: fontSize.md, fontFamily: fontFamily.regular },
} as const;

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Otp" component={OtpScreen} />
    </AuthStack.Navigator>
  );
}

/**
 * Six screens now — `Home`, G-7.1's `OfferInbox`, G-7.2's `ActiveDelivery`,
 * and the POD leg (`ProofCamera`, `ProofReview`, `DeliveryConfirm`). Still one
 * stack. The handoff's 4-tab bar arrives when รายได้ (BQ-029, `OPEN`) has
 * something behind it; งานของฉัน now does, but one of four tabs is not a tab
 * bar.
 *
 * The camera and review screens are presented with **no header**, so the app's
 * light chrome never flashes over a dark viewfinder. `DeliveryConfirm` keeps
 * its header: it is a light screen and a rider may legitimately want to go
 * back from it before confirming.
 */
function RiderNavigator() {
  return (
    <RiderStack.Navigator screenOptions={headerOptions}>
      <RiderStack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <RiderStack.Screen
        name="OfferInbox"
        component={OfferInboxScreen}
        options={{ title: 'งานที่เสนอ' }}
      />
      <RiderStack.Screen
        name="ActiveDelivery"
        component={ActiveDeliveryScreen}
        options={{ title: 'งานที่กำลังทำ' }}
      />
      <RiderStack.Screen
        name="ProofCamera"
        component={ProofCameraScreen}
        options={{ headerShown: false }}
      />
      <RiderStack.Screen
        name="ProofReview"
        component={ProofReviewScreen}
        options={{ headerShown: false }}
      />
      <RiderStack.Screen
        name="DeliveryConfirm"
        component={DeliveryConfirmScreen}
        options={{ title: 'ยืนยันการส่ง' }}
      />
    </RiderStack.Navigator>
  );
}

/**
 * Chooses the authenticated or unauthenticated tree.
 *
 * The choice is the Supabase session and nothing else. Whether the signed-in
 * user is an *approved rider* is a separate question, answered inside
 * `HomeScreen` from a fresh `riders` read — see `useAuth.tsx` for why the two
 * are kept apart.
 *
 * While the persisted session is being read we show the splash, so a rider who
 * was signed in last time never sees the login screen flash first.
 */
export function RootNavigator() {
  const { initialising, session } = useAuth();

  if (initialising) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>{session ? <RiderNavigator /> : <AuthNavigator />}</NavigationContainer>
  );
}
