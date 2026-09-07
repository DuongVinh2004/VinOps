import { DomainError } from '../errors.js';

export const dailyLogStatuses = ['Draft', 'Submitted', 'Confirmed', 'Amended'] as const;
export type DailyLogStatus = (typeof dailyLogStatuses)[number];

export const weatherTimeWindows = ['morning', 'noon', 'afternoon'] as const;
export type WeatherTimeWindow = (typeof weatherTimeWindows)[number];

export const weatherConditions = ['Sunny', 'Cloudy', 'Rainy', 'Stormy', 'Windy'] as const;
export type WeatherCondition = (typeof weatherConditions)[number];

export const equipmentOperationalStatuses = ['Operational', 'Standby', 'Breakdown'] as const;
export type EquipmentOperationalStatus = (typeof equipmentOperationalStatuses)[number];

/**
 * Invariant: Confirmed daily log is frozen against content alteration.
 */
export function assertDailyLogMutable(log: { status: DailyLogStatus; id: string }): void {
  if (log.status === 'Confirmed') {
    throw new DomainError(
      'DAILY_LOG_FROZEN',
      `Daily log ${log.id} is Confirmed and frozen against content modification.`,
    );
  }
}

/**
 * Confirms that daily log meets signature requirements before becoming Confirmed.
 * Requires both Site Manager (Chỉ huy trưởng) and Supervisor (TVGS) signatures.
 */
export function assertDailyLogConfirmation(signatures: {
  siteManagerSigned: boolean;
  supervisorSigned: boolean;
}): void {
  if (!signatures.siteManagerSigned || !signatures.supervisorSigned) {
    throw new DomainError(
      'DAILY_LOG_SIGNATURES_INCOMPLETE',
      'Daily log requires both Site Manager and Supervisor signatures for confirmation.',
    );
  }
}

/**
 * Validates GPS coordinates for weather lookup or site location.
 */
export function assertValidGpsCoordinates(lat: number, lng: number): void {
  if (lat < -90 || lat > 90 || Number.isNaN(lat)) {
    throw new DomainError('INVALID_GPS_LATITUDE', 'Latitude must be between -90 and 90.');
  }
  if (lng < -180 || lng > 180 || Number.isNaN(lng)) {
    throw new DomainError('INVALID_GPS_LONGITUDE', 'Longitude must be between -180 and 180.');
  }
}
