/**
 * LAUNCH_PLAN 1.1 — registers this device for push with the API after sign-in,
 * and revokes it on sign-out.
 *
 * Silent and best-effort by design: on a simulator, without permission, or
 * before the app has an EAS project id (`expo.extra.eas.projectId`, created by
 * `eas init` — an owner step), there is no token and nothing happens. A
 * failure here must never block signing in or out.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { apiClient } from './apiClient';

const APP = 'driver' as const;
let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function easProjectId(): string | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
  return extra.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = easProjectId();
    if (!projectId) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await apiClient.request<void>('/api/v1/me/push-tokens', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android', app: APP }),
    });
    registeredToken = token;
  } catch {
    // Push is an extra; the in-app notification list still works without it.
  }
}

export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  try {
    await apiClient.request<void>('/api/v1/me/push-tokens', { method: 'DELETE', body: JSON.stringify({ token }) });
  } catch {
    // Signing out must never fail because of push.
  }
}
