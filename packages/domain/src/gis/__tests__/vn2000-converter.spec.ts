import { describe, it, expect } from 'vitest';
import {
  vn2000ToWgs84,
  wgs84ToVn2000,
  VN2000_ZONES,
  type Vn2000Zone,
} from '../vn2000-converter.js';

describe('VN-2000 <-> WGS84 Geodetic Converter', () => {
  const testLocations: Array<{
    name: string;
    zone: Vn2000Zone;
    wgs84: { lat: number; lng: number };
  }> = [
    {
      name: 'TP. Hồ Chí Minh',
      zone: 'zone_3_hcm',
      wgs84: { lat: 10.8231, lng: 106.6297 },
    },
    {
      name: 'Thủ đô Hà Nội',
      zone: 'zone_3_hanoi',
      wgs84: { lat: 21.0278, lng: 105.8342 },
    },
    {
      name: 'Thành phố Đà Nẵng',
      zone: 'zone_3_danang',
      wgs84: { lat: 16.0544, lng: 108.2022 },
    },
  ];

  for (const loc of testLocations) {
    it(`performs accurate round-trip conversion for ${loc.name} (${loc.zone})`, () => {
      // 1. Forward WGS84 -> VN2000
      const vn2000 = wgs84ToVn2000(loc.wgs84.lat, loc.wgs84.lng, loc.zone);

      // Verify realistic planar values for Vietnam coordinates
      expect(vn2000.x).toBeGreaterThan(1_000_000); // Northing > 1000 km
      expect(vn2000.y).toBeGreaterThan(400_000); // Easting around 500 km +/- 100 km
      expect(vn2000.y).toBeLessThan(700_000);

      // 2. Inverse VN2000 -> WGS84
      const roundTrip = vn2000ToWgs84(vn2000.x, vn2000.y, loc.zone);

      // 3. Check error is less than 0.0001 degrees (~10 cm at equator)
      const latDiff = Math.abs(roundTrip.lat - loc.wgs84.lat);
      const lngDiff = Math.abs(roundTrip.lng - loc.wgs84.lng);

      expect(latDiff).toBeLessThan(0.0001);
      expect(lngDiff).toBeLessThan(0.0001);
    });
  }

  it('verifies central meridian definitions match TT 25/2014/TT-BTNMT', () => {
    expect(VN2000_ZONES.zone_3_hcm.centralMeridianDeg).toBe(105.75); // 105°45'
    expect(VN2000_ZONES.zone_3_hanoi.centralMeridianDeg).toBe(105.0); // 105°00'
    expect(VN2000_ZONES.zone_3_danang.centralMeridianDeg).toBe(107.75); // 107°45'
    expect(VN2000_ZONES.zone_3_hcm.scaleFactor).toBe(0.9999);
    expect(VN2000_ZONES.zone_6_48.scaleFactor).toBe(0.9996);
  });
});
