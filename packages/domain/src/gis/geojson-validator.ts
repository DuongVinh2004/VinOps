export type ValidationResult = {
  isValid: boolean;
  errors: string[];
};

export function validateGeoJSON(geojson: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof geojson !== 'object' || geojson === null) {
    return { isValid: false, errors: ['GeoJSON must be a non-null object'] };
  }

  const obj = geojson as Record<string, unknown>;
  const type = obj['type'];

  if (typeof type !== 'string') {
    return { isValid: false, errors: ['GeoJSON must have a "type" property'] };
  }

  switch (type) {
    case 'Point':
      validatePointCoordinates(obj['coordinates'], errors);
      break;
    case 'LineString':
      validateLineStringCoordinates(obj['coordinates'], errors);
      break;
    case 'Polygon':
      validatePolygonCoordinates(obj['coordinates'], errors);
      break;
    case 'MultiPoint':
      if (!Array.isArray(obj['coordinates'])) {
        errors.push('MultiPoint coordinates must be an array');
      } else {
        for (let i = 0; i < obj['coordinates'].length; i++) {
          validatePointCoordinates(obj['coordinates'][i], errors, `Point ${i}`);
        }
      }
      break;
    case 'MultiLineString':
      if (!Array.isArray(obj['coordinates'])) {
        errors.push('MultiLineString coordinates must be an array');
      } else {
        for (let i = 0; i < obj['coordinates'].length; i++) {
          validateLineStringCoordinates(obj['coordinates'][i], errors, `Line ${i}`);
        }
      }
      break;
    case 'MultiPolygon':
      if (!Array.isArray(obj['coordinates'])) {
        errors.push('MultiPolygon coordinates must be an array');
      } else {
        for (let i = 0; i < obj['coordinates'].length; i++) {
          validatePolygonCoordinates(obj['coordinates'][i], errors, `Polygon ${i}`);
        }
      }
      break;
    case 'Feature':
      if ('geometry' in obj && obj['geometry'] !== null) {
        const geomResult = validateGeoJSON(obj['geometry']);
        errors.push(...geomResult.errors);
      }
      break;
    case 'FeatureCollection':
      if (!Array.isArray(obj['features'])) {
        errors.push('FeatureCollection must have a "features" array');
      } else {
        for (let i = 0; i < obj['features'].length; i++) {
          const featResult = validateGeoJSON(obj['features'][i]);
          errors.push(...featResult.errors.map((e) => `Feature[${i}]: ${e}`));
        }
      }
      break;
    default:
      errors.push(`Unsupported GeoJSON geometry type: ${type}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function validatePosition(pos: unknown, errors: string[], prefix = 'Position'): boolean {
  if (!Array.isArray(pos) || pos.length < 2) {
    errors.push(`${prefix} must be an array of at least 2 numbers [lng, lat]`);
    return false;
  }

  const posArr = pos as readonly unknown[];
  const lng = posArr[0];
  const lat = posArr[1];
  if (typeof lng !== 'number' || isNaN(lng) || lng < -180 || lng > 180) {
    errors.push(`${prefix} longitude must be a number between -180 and 180`);
    return false;
  }

  if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
    errors.push(`${prefix} latitude must be a number between -90 and 90`);
    return false;
  }

  return true;
}

function validatePointCoordinates(coords: unknown, errors: string[], prefix = 'Point'): void {
  validatePosition(coords, errors, `${prefix} coordinates`);
}

function validateLineStringCoordinates(
  coords: unknown,
  errors: string[],
  prefix = 'LineString',
): void {
  if (!Array.isArray(coords) || coords.length < 2) {
    errors.push(`${prefix} must contain at least 2 coordinate positions`);
    return;
  }

  const coordsArr = coords as readonly unknown[];
  for (let i = 0; i < coordsArr.length; i++) {
    validatePosition(coordsArr[i], errors, `${prefix} position[${i}]`);
  }
}

function validatePolygonCoordinates(coords: unknown, errors: string[], prefix = 'Polygon'): void {
  if (!Array.isArray(coords) || coords.length === 0) {
    errors.push(`${prefix} coordinates must be an array of linear rings`);
    return;
  }

  const coordsArr = coords as readonly unknown[];
  for (let ringIdx = 0; ringIdx < coordsArr.length; ringIdx++) {
    const ring = coordsArr[ringIdx];
    const ringName = `${prefix} ring[${ringIdx}]`;

    if (!Array.isArray(ring) || ring.length < 4) {
      errors.push(`${ringName} must contain at least 4 positions`);
      continue;
    }

    const ringArr = ring as readonly unknown[];
    // Check closure (first point equals last point)
    const first = ringArr[0];
    const last = ringArr[ringArr.length - 1];

    if (
      !Array.isArray(first) ||
      !Array.isArray(last) ||
      (first as readonly unknown[])[0] !== (last as readonly unknown[])[0] ||
      (first as readonly unknown[])[1] !== (last as readonly unknown[])[1]
    ) {
      errors.push(`${ringName} is not closed: first and last positions must be identical`);
    }

    for (let posIdx = 0; posIdx < ringArr.length; posIdx++) {
      validatePosition(ringArr[posIdx], errors, `${ringName} pos[${posIdx}]`);
    }
  }
}
