import { vn2000ToWgs84, type Vn2000Zone } from '@vinops/domain';

export type DxfEntity = {
  type: string;
  layer: string;
  vertices: Array<{ x: number; y: number; z?: number }>;
  properties?: Record<string, unknown>;
};

export type GeoJsonFeature = {
  type: 'Feature';
  geometry: {
    type: 'LineString' | 'Polygon' | 'Point';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, unknown>;
};

export type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

export class DxfToGeoJsonService {
  /**
   * Parses raw DXF text format into vector entities.
   */
  parseDxf(dxfContent: string): DxfEntity[] {
    const lines = dxfContent.split(/\r?\n/).map((l) => l.trim());
    const entities: DxfEntity[] = [];

    let i = 0;
    let inEntitiesSection = false;

    while (i < lines.length - 1) {
      const code = lines[i];
      const val = lines[i + 1] ?? '';

      if (code === '2' && val === 'ENTITIES') {
        inEntitiesSection = true;
        i += 2;
        continue;
      }

      if (code === '0' && val === 'ENDSEC') {
        if (inEntitiesSection) break;
      }

      if (inEntitiesSection && code === '0') {
        // Start of an entity
        const entityType = val;
        let layer = '0';
        const vertices: Array<{ x: number; y: number; z?: number }> = [];
        let curX: number | null = null;
        let isClosed = false;

        i += 2;
        while (i < lines.length - 1 && lines[i] !== '0') {
          const subCode = lines[i];
          const subVal = lines[i + 1] ?? '';

          if (subCode === '8') {
            layer = subVal;
          } else if (subCode === '70') {
            // Flag 1 = closed polyline
            isClosed = (parseInt(subVal, 10) & 1) === 1;
          } else if (subCode === '10') {
            curX = parseFloat(subVal);
          } else if (subCode === '20') {
            const y = parseFloat(subVal);
            if (curX !== null && !isNaN(curX) && !isNaN(y)) {
              vertices.push({ x: curX, y });
              curX = null;
            }
          } else if (subCode === '11') {
            // End point for LINE
            curX = parseFloat(subVal);
          } else if (subCode === '21') {
            const y = parseFloat(subVal);
            if (curX !== null && !isNaN(curX) && !isNaN(y)) {
              vertices.push({ x: curX, y });
              curX = null;
            }
          }
          i += 2;
        }

        if (vertices.length > 0) {
          if (isClosed && vertices.length >= 3) {
            vertices.push({ ...vertices[0]! });
          }
          entities.push({
            type: entityType,
            layer,
            vertices,
            properties: { isClosed },
          });
        }
        continue;
      }

      i += 2;
    }

    return entities;
  }

  /**
   * Converts DXF entities from planar VN-2000 coordinates to a WGS84 GeoJSON FeatureCollection.
   */
  convertDxfToGeoJson(
    dxfContent: string,
    zoneKey: Vn2000Zone = 'zone_3_hcm',
  ): GeoJsonFeatureCollection {
    const entities = this.parseDxf(dxfContent);
    const features: GeoJsonFeature[] = [];

    for (const ent of entities) {
      // Transform each vertex from VN2000 (x: Northing, y: Easting) to WGS84 (lng, lat)
      const wgsCoords = ent.vertices.map((v) => {
        // DXF typically stores CAD X as Easting and Y as Northing (or vice versa depending on surveyor setup)
        // We assume X=Easting (vn2000_y) and Y=Northing (vn2000_x) standard CAD planar representation
        const { lat, lng } = vn2000ToWgs84(v.y, v.x, zoneKey);
        return [lng, lat];
      });

      if (wgsCoords.length === 1) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: wgsCoords[0]!,
          },
          properties: {
            layer: ent.layer,
            cadType: ent.type,
          },
        });
      } else if (wgsCoords.length >= 4 && ent.properties?.['isClosed']) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [wgsCoords],
          },
          properties: {
            layer: ent.layer,
            cadType: ent.type,
          },
        });
      } else if (wgsCoords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: wgsCoords,
          },
          properties: {
            layer: ent.layer,
            cadType: ent.type,
          },
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }
}
