import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  IBMPlexSansThai_400Regular,
  IBMPlexSansThai_500Medium,
  IBMPlexSansThai_600SemiBold,
  IBMPlexSansThai_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-thai';
import { AuthProvider } from './src/hooks/useAuth';
import { CartProvider } from './src/hooks/useCart';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SplashScreen } from './src/screens/auth/SplashScreen';

/**
 * BANHAO Customer App.
 *
 * Fonts are bundled with the app — the TTF files ship inside
 * @expo-google-fonts/ibm-plex-sans-thai and Metro packages them at build time.
 * Nothing is fetched from Google at runtime.
 *
 * The four weights the design specifies (400/500/600/700) are each a separate
 * family in React Native; see packages/ui/src/theme/tokens.ts.
 *
 * Rendering is held on the splash screen until fonts resolve. Without that,
 * the first frame paints in the system face and then reflows once Thai metrics
 * change — visible and cheap to avoid.
 *
 * Provider order matters: SafeAreaProvider wraps everything using insets, and
 * AuthProvider wraps RootNavigator since the navigator picks its tree from
 * session state.
 */
export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansThai_400Regular,
    IBMPlexSansThai_500Medium,
    IBMPlexSansThai_600SemiBold,
    IBMPlexSansThai_700Bold,
  });

  // On font failure the app still starts, in the platform face, rather than
  // hanging on the splash forever — a wrong typeface beats an unusable app.
  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SplashScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CartProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </CartProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
