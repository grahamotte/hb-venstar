const HOMEKIT_SERIAL_NUMBER_MAX_LENGTH = 64;
const MAC_ADDRESS_PATTERN = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/iu;

export function homeKitSerialNumber(deviceId: string, usn?: string): string {
  const macAddress = usn?.match(MAC_ADDRESS_PATTERN)?.[0];
  if (macAddress) {
    return macAddress.toUpperCase();
  }

  return deviceId.slice(0, HOMEKIT_SERIAL_NUMBER_MAX_LENGTH);
}
