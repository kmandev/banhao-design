import * as Location from 'expo-location';

/**
 * The device's own position, captured in the foreground only.
 *
 * ## The boundary this module exists to hold
 *
 * DEC-037 makes *"a valid recorded location"* part of dispatch eligibility, so
 * the Driver App has to capture a position at all. Q-012 (PDPA lawful basis
 * and retention) and TQ-016 (rider location retention and access) are both
 * `OPEN`, and `RiderLocationService` on the server is explicit that it writes
 * *latest position only* — no history table, no append log, no retention rule —
 * precisely so that it "neither answers nor pre-empts them".
 *
 * This module holds the same line on the device side:
 *
 * - **Foreground permission only.** `requestForegroundPermissionsAsync` is the
 *   only permission ever requested. Background permission is never asked for
 *   and `app.json` declares neither the Android nor the iOS background mode.
 * - **One reading per call.** No `watchPositionAsync`, no interval, no
 *   geofence, no background task, no queue. The caller decides when a capture
 *   happens, and the only two callers are "the rider tapped go online" and
 *   "the rider tapped refresh".
 * - **Nothing is stored here.** The position is returned to the caller, posted
 *   once, and forgotten. The device keeps no copy.
 *
 * Adding continuous tracking would pre-empt Q-012 and is out of scope for
 * Phase G — see `docs/OPEN_BUSINESS_QUESTIONS.md` and TQ-016.
 */

/** A single foreground reading. Exactly the pair the server's schema accepts. */
export interface DevicePosition {
  lat: number;
  lng: number;
}

/**
 * The rider declined (or the OS refused) foreground location.
 *
 * A distinct type rather than a message, because the caller must treat it
 * differently from a network failure: a denied permission is not retryable by
 * itself and must never leave the rider showing as online.
 */
export class LocationPermissionDeniedError extends Error {
  constructor() {
    super('ต้องอนุญาตให้เข้าถึงตำแหน่งก่อนจึงจะเปิดรับงานได้');
    this.name = 'LocationPermissionDeniedError';
  }
}

/** The device could not produce a fix, even though permission was granted. */
export class LocationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

/**
 * Asks for foreground permission if it is not already held, then takes one
 * reading.
 *
 * `requestForegroundPermissionsAsync` is a no-op prompt when permission is
 * already granted, so there is no separate "check then request" path to get
 * out of step with the OS.
 */
export async function captureForegroundPosition(): Promise<DevicePosition> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) {
    throw new LocationPermissionDeniedError();
  }

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch (error) {
    throw new LocationUnavailableError(
      error instanceof Error ? error.message : 'อ่านตำแหน่งไม่สำเร็จ',
    );
  }

  const { latitude, longitude } = position.coords;

  // A half-pair is never sent onward: `rider_availability.location` is
  // generated from both columns and is null unless both are present, so a
  // partial reading would silently leave the rider undispatchable.
  // `riderLocationRequestSchema` rejects it at the API boundary too; this is
  // the same refusal one layer earlier, with a message a rider can act on.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new LocationUnavailableError('อ่านตำแหน่งไม่สำเร็จ');
  }

  return { lat: latitude, lng: longitude };
}
