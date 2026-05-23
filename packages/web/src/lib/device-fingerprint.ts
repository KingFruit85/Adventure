const KEY = 'loreforge.deviceFingerprint';

/**
 * Returns the device's fingerprint — a UUID stable across reloads. Generated
 * once on first call and persisted to localStorage. Used as the API's
 * `x-device-fingerprint` header so /device-sessions lists this device's
 * sessions without requiring login.
 */
export function getDeviceFingerprint(): string {
  let fp = localStorage.getItem(KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(KEY, fp);
  }
  return fp;
}
