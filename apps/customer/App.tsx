import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/hooks/useAuth';
import { CartProvider } from './src/hooks/useCart';
import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * BANHAO Customer App.
 *
 * Provider order matters: SafeAreaProvider must wrap everything that uses
 * insets, and AuthProvider must wrap RootNavigator since the navigator picks
 * the auth or customer tree from session state.
 */
export default function App() {
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
