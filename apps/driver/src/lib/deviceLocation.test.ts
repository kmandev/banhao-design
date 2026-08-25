import * as Location from 'expo-location';
import {
  LocationPermissionDeniedError,
  LocationUnavailableError,
  captureForegroundPosition,
} from './deviceLocation';

/**
 * The PDPA boundary, asserted rather than assumed.
 *
 * Q-012 (lawful basis and retention) and TQ-016 (rider location retention and
 * access) are both `OPEN`, and `RiderLocationService` on the server keeps
 * *latest position only* so as not to pre-empt them. These tests hold the same
 * line on the device: foreground permission only, one reading per call, and no
 * watcher, background task or geofence anywhere in the module.
 */

const mocked = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
});

function grant(granted: boolean) {
  mocked.requestForegroundPermissionsAsync.mockResolvedValue({
    granted,
  } as unknown as Location.LocationPermissionResponse);
}

function fix(coords: { latitude: number; longitude: number }) {
  mocked.getCurrentPositionAsync.mockResolvedValue({
    coords,
  } as unknown as Location.LocationObject);
}

describe('captureForegroundPosition — permission', () => {
  it('requests foreground permission only, never background', async () => {
    grant(true);
    fix({ latitude: 14.78, longitude: 105.32 });

    await captureForegroundPosition();

    expect(mocked.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(
      (mocked as unknown as Record<string, unknown>).requestBackgroundPermissionsAsync,
    ).toBeUndefined();
  });

  it('throws LocationPermissionDeniedError and takes no reading when permission is refused', async () => {
    grant(false);

    await expect(captureForegroundPosition()).rejects.toBeInstanceOf(LocationPermissionDeniedError);
    expect(mocked.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

describe('captureForegroundPosition — one reading, never a stream', () => {
  it('takes exactly one reading per call', async () => {
    grant(true);
    fix({ latitude: 14.78, longitude: 105.32 });

    await captureForegroundPosition();

    expect(mocked.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('never starts a watcher, a background task, or a geofence', async () => {
    grant(true);
    fix({ latitude: 14.78, longitude: 105.32 });

    await captureForegroundPosition();

    const forbidden = [
      'watchPositionAsync',
      'startLocationUpdatesAsync',
      'startGeofencingAsync',
    ] as const;

    for (const api of forbidden) {
      const fn = (mocked as unknown as Record<string, jest.Mock | undefined>)[api];
      // Either the API was never mocked into existence, or it was never called.
      expect(fn === undefined || fn.mock.calls.length === 0).toBe(true);
    }
  });

  it('returns the coordinate pair the API contract expects', async () => {
    grant(true);
    fix({ latitude: 14.78, longitude: 105.32 });

    await expect(captureForegroundPosition()).resolves.toEqual({ lat: 14.78, lng: 105.32 });
  });
});

describe('captureForegroundPosition — a half pair is never returned', () => {
  it.each([
    ['latitude', { latitude: Number.NaN, longitude: 105.32 }],
    ['longitude', { latitude: 14.78, longitude: Number.NaN }],
    ['both', { latitude: Number.NaN, longitude: Number.NaN }],
  ])('throws when %s is not finite', async (_label, coords) => {
    grant(true);
    fix(coords);

    await expect(captureForegroundPosition()).rejects.toBeInstanceOf(LocationUnavailableError);
  });

  it('throws LocationUnavailableError when the device cannot produce a fix', async () => {
    grant(true);
    mocked.getCurrentPositionAsync.mockRejectedValue(new Error('location services disabled'));

    await expect(captureForegroundPosition()).rejects.toBeInstanceOf(LocationUnavailableError);
  });
});
