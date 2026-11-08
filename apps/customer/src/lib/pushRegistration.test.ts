import * as Notifications from 'expo-notifications';
import { apiClient } from './apiClient';
import { registerForPush, unregisterPush } from './pushRegistration';

let mockIsDevice = false;
let mockProjectId: string | null = null;

jest.mock('./apiClient', () => ({ apiClient: { request: jest.fn() } }));
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockProjectId ? { extra: { eas: { projectId: mockProjectId } } } : { extra: {} };
    },
    easConfig: null,
  },
}));

const request = apiClient.request as jest.Mock;

function asDevice(isDevice: boolean, projectId: string | null) {
  mockIsDevice = isDevice;
  mockProjectId = projectId;
}

beforeEach(() => {
  request.mockReset().mockResolvedValue(undefined);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[abc]' });
});

describe('push registration (LAUNCH_PLAN 1.1)', () => {
  it('does nothing on a simulator', async () => {
    asDevice(false, 'proj-1');
    await registerForPush();
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing until the app has an EAS project id', async () => {
    asDevice(true, null);
    await registerForPush();
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing when the user declines notifications', async () => {
    asDevice(true, 'proj-1');
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    await registerForPush();
    expect(request).not.toHaveBeenCalled();
  });

  it('sends the device token to the API, then revokes it on sign-out', async () => {
    asDevice(true, 'proj-1');
    await registerForPush();
    expect(request).toHaveBeenCalledWith('/api/v1/me/push-tokens', {
      method: 'POST',
      body: expect.stringContaining('"token":"ExponentPushToken[abc]"'),
    });
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ app: 'customer' });

    await unregisterPush();
    expect(request).toHaveBeenLastCalledWith('/api/v1/me/push-tokens', {
      method: 'DELETE',
      body: JSON.stringify({ token: 'ExponentPushToken[abc]' }),
    });
  });

  it('never throws, even when the API is down', async () => {
    asDevice(true, 'proj-1');
    request.mockRejectedValue(new Error('offline'));
    await expect(registerForPush()).resolves.toBeUndefined();
  });
});
