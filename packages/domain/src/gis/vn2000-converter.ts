import { DomainError } from '../errors.js';

export type Vn2000Zone =
  | 'zone_3_hcm'
  | 'zone_3_hanoi'
  | 'zone_3_danang'
  | 'zone_3_haiphong'
  | 'zone_3_cantho'
  | 'zone_3_dongnai'
  | 'zone_3_binhduong'
  | 'zone_3_quangninh'
  | 'zone_3_khanhhoa'
  | 'zone_6_48'
  | 'zone_6_49';

export type ZoneDefinition = {
  name: string;
  centralMeridianDeg: number; // Kinh tuyến trục (độ)
  scaleFactor: number; // k0: 0.9999 cho 3°, 0.9996 cho 6°
  falseEasting: number; // 500,000 m
  falseNorthing: number; // 0 m
};

export const VN2000_ZONES: Record<Vn2000Zone, ZoneDefinition> = {
  zone_3_hcm: {
    name: "TP. Hồ Chí Minh (105°45')",
    centralMeridianDeg: 105.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_hanoi: {
    name: "Hà Nội (105°00')",
    centralMeridianDeg: 105.0,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_danang: {
    name: "Đà Nẵng (107°45')",
    centralMeridianDeg: 107.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_haiphong: {
    name: "Hải Phòng (105°45')",
    centralMeridianDeg: 105.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_cantho: {
    name: "Cần Thơ (105°00')",
    centralMeridianDeg: 105.0,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_dongnai: {
    name: "Đồng Nai (107°45')",
    centralMeridianDeg: 107.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_binhduong: {
    name: "Bình Dương (105°45')",
    centralMeridianDeg: 105.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_quangninh: {
    name: "Quảng Ninh (107°45')",
    centralMeridianDeg: 107.75,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_3_khanhhoa: {
    name: "Khánh Hòa (108°15')",
    centralMeridianDeg: 108.25,
    scaleFactor: 0.9999,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_6_48: {
    name: "Múi 6° Zone 48 (105°00')",
    centralMeridianDeg: 105.0,
    scaleFactor: 0.9996,
    falseEasting: 500000,
    falseNorthing: 0,
  },
  zone_6_49: {
    name: "Múi 6° Zone 49 (111°00')",
    centralMeridianDeg: 111.0,
    scaleFactor: 0.9996,
    falseEasting: 500000,
    falseNorthing: 0,
  },
};

// Ellipsoid Constants
const WGS84 = {
  a: 6378137.0, // Semi-major axis
  f: 1 / 298.257223563, // Flattening
  b: 6356752.314245, // a * (1 - f)
  e2: 0.00669437999014, // 2f - f^2
};

const VN2000_ELLIPSOID = {
  a: 6378245.0, // Krasovsky 1940
  f: 1 / 298.3,
  b: 6356863.018773,
  e2: 0.00669342162297,
};

// 7-Parameter Bursa-Wolf Transformation (VN2000 -> WGS84)
// Standardized by Ministry of Natural Resources and Environment (TT 25/2014/TT-BTNMT)
const BURSA_WOLF_PARAMS = {
  dx: -191.9044,
  dy: -39.3032,
  dz: -111.4503,
  wx: -0.0092883 * (Math.PI / (180 * 3600)), // radians
  wy: 0.0340263 * (Math.PI / (180 * 3600)),
  wz: -0.0316483 * (Math.PI / (180 * 3600)),
  m: -0.00000142917, // Scale factor = (1 + m)
};

/**
 * Converts geodetic coordinates (lat, lng, h) to geocentric Cartesian (X, Y, Z).
 */
function geodeticToCartesian(latRad: number, lngRad: number, h: number, a: number, e2: number) {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  const X = (N + h) * cosLat * Math.cos(lngRad);
  const Y = (N + h) * cosLat * Math.sin(lngRad);
  const Z = (N * (1 - e2) + h) * sinLat;

  return { X, Y, Z };
}

/**
 * Converts geocentric Cartesian (X, Y, Z) to geodetic (lat, lng, h) using Bowring algorithm.
 */
function cartesianToGeodetic(X: number, Y: number, Z: number, a: number, e2: number) {
  const b = a * Math.sqrt(1 - e2);
  const ePrime2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(X, Y);

  const theta = Math.atan2(Z * a, p * b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const lat = Math.atan2(
    Z + ePrime2 * b * sinTheta * sinTheta * sinTheta,
    p - e2 * a * cosTheta * cosTheta * cosTheta,
  );
  const lng = Math.atan2(Y, X);

  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const h = p / Math.cos(lat) - N;

  return { lat, lng, h };
}

/**
 * Forward Transverse Mercator (Gauss-Krüger) projection: (lat, lng) -> (X, Y)
 */
function transverseMercatorForward(
  latDeg: number,
  lngDeg: number,
  zone: ZoneDefinition,
  ellipsoid = VN2000_ELLIPSOID,
) {
  const latRad = (latDeg * Math.PI) / 180;
  const lngRad = (lngDeg * Math.PI) / 180;
  const cmRad = (zone.centralMeridianDeg * Math.PI) / 180;
  const deltaLng = lngRad - cmRad;

  const a = ellipsoid.a;
  const e2 = ellipsoid.e2;
  const k0 = zone.scaleFactor;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = (e2 / (1 - e2)) * cosLat * cosLat;
  const A = deltaLng * cosLat;

  // Meridian distance M
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e6) / 3072) * Math.sin(6 * latRad));

  const x =
    k0 *
      N *
      (A +
        ((1 - T + C) * A * A * A) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * (e2 / (1 - e2))) * A * A * A * A * A) / 120) +
    zone.falseEasting;

  const y =
    k0 *
      (M +
        N *
          tanLat *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A * A * A * A) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * (e2 / (1 - e2))) * A * A * A * A * A * A) /
              720)) +
    zone.falseNorthing;

  return { x, y };
}

/**
 * Inverse Transverse Mercator: (X, Y) -> (lat, lng)
 */
function transverseMercatorInverse(
  x: number,
  y: number,
  zone: ZoneDefinition,
  ellipsoid = VN2000_ELLIPSOID,
) {
  const a = ellipsoid.a;
  const e2 = ellipsoid.e2;
  const k0 = zone.scaleFactor;

  const xAdjusted = x - zone.falseEasting;
  const yAdjusted = y - zone.falseNorthing;

  const M = yAdjusted / k0;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 * e1 * e1) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 * e1 * e1 * e1) / 32) * Math.sin(4 * mu) +
    ((151 * e1 * e1 * e1) / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = xAdjusted / (N1 * k0);

  const T1 = tanPhi1 * tanPhi1;
  const C1 = (e2 / (1 - e2)) * cosPhi1 * cosPhi1;

  const latRad =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D * D * D * D) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) *
          D *
          D *
          D *
          D *
          D *
          D) /
          720);

  const lngRad =
    (zone.centralMeridianDeg * Math.PI) / 180 +
    (D -
      ((1 + 2 * T1 + C1) * D * D * D) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) *
        D *
        D *
        D *
        D *
        D) /
        120) /
      cosPhi1;

  return {
    latDeg: (latRad * 180) / Math.PI,
    lngDeg: (lngRad * 180) / Math.PI,
  };
}

/**
 * 7-Parameter Helmert datum transformation: VN-2000 -> WGS-84
 */
function datumTransformVn2000ToWgs84(latVnDeg: number, lngVnDeg: number, h = 0) {
  const p = BURSA_WOLF_PARAMS;
  const { X, Y, Z } = geodeticToCartesian(
    (latVnDeg * Math.PI) / 180,
    (lngVnDeg * Math.PI) / 180,
    h,
    VN2000_ELLIPSOID.a,
    VN2000_ELLIPSOID.e2,
  );

  const scale = 1 + p.m;
  const xWgs = p.dx + scale * (X - p.wz * Y + p.wy * Z);
  const yWgs = p.dy + scale * (p.wz * X + Y - p.wx * Z);
  const zWgs = p.dz + scale * (-p.wy * X + p.wx * Y + Z);

  const geodetic = cartesianToGeodetic(xWgs, yWgs, zWgs, WGS84.a, WGS84.e2);
  return {
    latDeg: (geodetic.lat * 180) / Math.PI,
    lngDeg: (geodetic.lng * 180) / Math.PI,
    h: geodetic.h,
  };
}

/**
 * Inverse 7-Parameter Helmert transformation: WGS-84 -> VN-2000
 */
function datumTransformWgs84ToVn2000(latWgsDeg: number, lngWgsDeg: number, h = 0) {
  const p = BURSA_WOLF_PARAMS;
  const { X, Y, Z } = geodeticToCartesian(
    (latWgsDeg * Math.PI) / 180,
    (lngWgsDeg * Math.PI) / 180,
    h,
    WGS84.a,
    WGS84.e2,
  );

  const scale = 1 / (1 + p.m);
  const xDiff = X - p.dx;
  const yDiff = Y - p.dy;
  const zDiff = Z - p.dz;

  // Inverse rotation matrix (transpose of skew-symmetric matrix)
  const xVn = scale * (xDiff + p.wz * yDiff - p.wy * zDiff);
  const yVn = scale * (-p.wz * xDiff + yDiff + p.wx * zDiff);
  const zVn = scale * (p.wy * xDiff - p.wx * yDiff + zDiff);

  const geodetic = cartesianToGeodetic(xVn, yVn, zVn, VN2000_ELLIPSOID.a, VN2000_ELLIPSOID.e2);
  return {
    latDeg: (geodetic.lat * 180) / Math.PI,
    lngDeg: (geodetic.lng * 180) / Math.PI,
    h: geodetic.h,
  };
}

/**
 * Transforms VN-2000 planar coordinates (X: North, Y: East in meters) to WGS84 (Lat, Lng).
 * Note: In Vietnamese surveying practice, VN2000_X is North (Northing) and VN2000_Y is East (Easting).
 */
export function vn2000ToWgs84(
  northingX: number,
  eastingY: number,
  zoneKey: string,
): { lat: number; lng: number } {
  const zone = VN2000_ZONES[zoneKey as Vn2000Zone];
  if (!zone) {
    throw new DomainError('INVALID_VN2000_ZONE', `Unsupported VN-2000 zone: ${zoneKey}`);
  }

  // 1. Inverse projection on VN2000 ellipsoid
  const { latDeg: latVn, lngDeg: lngVn } = transverseMercatorInverse(
    eastingY,
    northingX,
    zone,
    VN2000_ELLIPSOID,
  );

  // 2. 7-Parameter datum transformation to WGS84
  const { latDeg, lngDeg } = datumTransformVn2000ToWgs84(latVn, lngVn, 0);

  return {
    lat: Number(latDeg.toFixed(7)),
    lng: Number(lngDeg.toFixed(7)),
  };
}

/**
 * Transforms WGS84 (Lat, Lng) to VN-2000 planar coordinates (X: North, Y: East in meters).
 */
export function wgs84ToVn2000(
  latDeg: number,
  lngDeg: number,
  zoneKey: string,
): { x: number; y: number } {
  const zone = VN2000_ZONES[zoneKey as Vn2000Zone];
  if (!zone) {
    throw new DomainError('INVALID_VN2000_ZONE', `Unsupported VN-2000 zone: ${zoneKey}`);
  }

  // 1. Datum transformation WGS84 -> VN-2000
  const { latDeg: latVn, lngDeg: lngVn } = datumTransformWgs84ToVn2000(latDeg, lngDeg, 0);

  // 2. Forward Transverse Mercator projection
  const { x: easting, y: northing } = transverseMercatorForward(
    latVn,
    lngVn,
    zone,
    VN2000_ELLIPSOID,
  );

  return {
    x: Number(northing.toFixed(4)), // VN-2000 X (Northing)
    y: Number(easting.toFixed(4)), // VN-2000 Y (Easting)
  };
}
