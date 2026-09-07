import { DomainError } from '../errors.js';

export type GpsCoordinates = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
};

export function validateGpsCoordinates(coords: GpsCoordinates): void {
  if (typeof coords.latitude !== 'number' || Number.isNaN(coords.latitude)) {
    throw new DomainError('INVALID_GPS_COORDINATES', 'Latitude must be a valid number.');
  }
  if (coords.latitude < -90 || coords.latitude > 90) {
    throw new DomainError(
      'INVALID_GPS_COORDINATES',
      'Latitude must be between -90 and 90 degrees.',
    );
  }
  if (typeof coords.longitude !== 'number' || Number.isNaN(coords.longitude)) {
    throw new DomainError('INVALID_GPS_COORDINATES', 'Longitude must be a valid number.');
  }
  if (coords.longitude < -180 || coords.longitude > 180) {
    throw new DomainError(
      'INVALID_GPS_COORDINATES',
      'Longitude must be between -180 and 180 degrees.',
    );
  }
  if (coords.accuracyMeters !== undefined) {
    if (
      typeof coords.accuracyMeters !== 'number' ||
      Number.isNaN(coords.accuracyMeters) ||
      coords.accuracyMeters < 0
    ) {
      throw new DomainError(
        'INVALID_GPS_COORDINATES',
        'Accuracy in meters must be a non-negative number.',
      );
    }
  }
}

/**
 * Calculates distance between two GPS coordinates in meters using Haversine formula.
 */
export function calculateGpsDistanceMeters(a: GpsCoordinates, b: GpsCoordinates): number {
  validateGpsCoordinates(a);
  validateGpsCoordinates(b);

  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);

  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);

  const chord =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * sinHalfLon * sinHalfLon;

  const angularDistance = 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
  return earthRadiusMeters * angularDistance;
}
