import type { IfcAPI } from 'web-ifc';
import * as WebIFC from 'web-ifc';

export type PropertyMap = Record<string, Record<string, string | number | boolean>>;

interface IfcEntityRef {
  value?: number | undefined;
}

interface IfcValueWrapper {
  value?: string | number | boolean | null | undefined;
}

interface IfcEntity {
  Name?: IfcValueWrapper | undefined;
  Description?: IfcValueWrapper | undefined;
  ObjectType?: IfcValueWrapper | undefined;
  Tag?: IfcValueWrapper | undefined;
  RelatedObjects?: IfcEntityRef[] | undefined;
  RelatingPropertyDefinition?: IfcEntityRef | undefined;
  RelatingMaterial?: IfcEntityRef | undefined;
  HasProperties?: IfcEntityRef[] | undefined;
  Quantities?: IfcEntityRef[] | undefined;
  LengthValue?: IfcValueWrapper | undefined;
  AreaValue?: IfcValueWrapper | undefined;
  VolumeValue?: IfcValueWrapper | undefined;
  WeightValue?: IfcValueWrapper | undefined;
  CountValue?: IfcValueWrapper | undefined;
  NominalValue?: IfcValueWrapper | undefined;
  ForLayerSet?: IfcValueWrapper | undefined;
}

function toPrimitiveString(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

/**
 * Extracts PropertySets, Quantities, and Material data for IFC entities from Web-IFC model
 */
export class IfcPropertyExtractor {
  constructor(
    private readonly ifcApi: IfcAPI,
    private readonly modelId: number,
  ) {}

  /**
   * Extract all properties for an element by expressID
   */
  extractProperties(expressId: number): PropertyMap {
    const result: PropertyMap = {};

    try {
      // 1. Direct entity basic info
      const entity = this.ifcApi.GetLine(this.modelId, expressId) as IfcEntity | undefined;
      if (entity) {
        const directProps: Record<string, string | number | boolean> = {};
        if (entity.Name?.value !== undefined)
          directProps['Name'] = toPrimitiveString(entity.Name.value);
        if (entity.Description?.value !== undefined)
          directProps['Description'] = toPrimitiveString(entity.Description.value);
        if (entity.ObjectType?.value !== undefined)
          directProps['ObjectType'] = toPrimitiveString(entity.ObjectType.value);
        if (entity.Tag?.value !== undefined)
          directProps['Tag'] = toPrimitiveString(entity.Tag.value);
        if (Object.keys(directProps).length > 0) {
          result['Attributes'] = directProps;
        }
      }

      // 2. Scan all IFCRELDEFINESBYPROPERTIES
      const relDefinesLines = this.getAllLinesOfType('IFCRELDEFINESBYPROPERTIES');
      for (const relLine of relDefinesLines) {
        const relatedObjects = relLine.RelatedObjects;
        if (!Array.isArray(relatedObjects)) continue;

        const isRelated = relatedObjects.some((ro) => ro.value === expressId);
        if (!isRelated) continue;

        const propDefId = relLine.RelatingPropertyDefinition?.value;
        if (!propDefId) continue;

        const propDef = this.ifcApi.GetLine(this.modelId, propDefId) as IfcEntity | undefined;
        if (!propDef) continue;

        const psetName = toPrimitiveString(propDef.Name?.value) || 'Pset_Unknown';

        // Check if IFCPROPERTYSET
        if (propDef.HasProperties && Array.isArray(propDef.HasProperties)) {
          if (!result[psetName]) result[psetName] = {};
          for (const propRef of propDef.HasProperties) {
            const propId = propRef.value;
            if (!propId) continue;
            const prop = this.ifcApi.GetLine(this.modelId, propId) as IfcEntity | undefined;
            if (!prop || prop.Name?.value === undefined) continue;

            const pName = toPrimitiveString(prop.Name.value);
            const val = this.unwrapPropertyValue(prop.NominalValue);
            if (val !== undefined) {
              result[psetName][pName] = val;
            }
          }
        }

        // Check if IFCELEMENTQUANTITY
        if (propDef.Quantities && Array.isArray(propDef.Quantities)) {
          const quantGroupName = psetName.startsWith('Qto_') ? psetName : `Qto_${psetName}`;
          if (!result[quantGroupName]) result[quantGroupName] = {};
          for (const qRef of propDef.Quantities) {
            const qId = qRef.value;
            if (!qId) continue;
            const q = this.ifcApi.GetLine(this.modelId, qId) as IfcEntity | undefined;
            if (!q || q.Name?.value === undefined) continue;

            const qName = toPrimitiveString(q.Name.value);
            const qVal =
              q.LengthValue?.value ??
              q.AreaValue?.value ??
              q.VolumeValue?.value ??
              q.WeightValue?.value ??
              q.CountValue?.value;
            if (typeof qVal === 'number' || typeof qVal === 'string' || typeof qVal === 'boolean') {
              result[quantGroupName][qName] = qVal;
            }
          }
        }
      }

      // 3. Scan IFCRELASSOCIATESMATERIAL
      const relMaterials = this.getAllLinesOfType('IFCRELASSOCIATESMATERIAL');
      for (const relLine of relMaterials) {
        const relatedObjects = relLine.RelatedObjects;
        if (!Array.isArray(relatedObjects)) continue;
        const isRelated = relatedObjects.some((ro) => ro.value === expressId);
        if (!isRelated) continue;

        const matDefId = relLine.RelatingMaterial?.value;
        if (!matDefId) continue;
        const mat = this.ifcApi.GetLine(this.modelId, matDefId) as IfcEntity | undefined;
        if (!mat) continue;

        if (!result['Materials']) result['Materials'] = {};
        if (mat.Name?.value !== undefined) {
          result['Materials']['MaterialName'] = toPrimitiveString(mat.Name.value);
        } else if (mat.ForLayerSet?.value !== undefined) {
          result['Materials']['LayerSet'] = toPrimitiveString(mat.ForLayerSet.value);
        }
      }
    } catch {
      // Fallback empty if parsing failed for expressID
    }

    return result;
  }

  private getAllLinesOfType(typeName: string): IfcEntity[] {
    try {
      const constants = WebIFC as unknown as Record<string, number>;
      const typeConst = constants[typeName];
      if (!typeConst) return [];

      const lines = this.ifcApi.GetLineIDsWithType(this.modelId, typeConst);
      if (!lines) return [];
      const size = lines.size();
      const result: IfcEntity[] = [];
      for (let i = 0; i < size; i++) {
        const id = lines.get(i);
        const line = this.ifcApi.GetLine(this.modelId, id) as IfcEntity | undefined;
        if (line) result.push(line);
      }
      return result;
    } catch {
      return [];
    }
  }

  private unwrapPropertyValue(
    nominalValue: IfcValueWrapper | undefined,
  ): string | number | boolean | undefined {
    if (nominalValue === undefined || nominalValue === null) return undefined;
    if (
      typeof nominalValue.value === 'string' ||
      typeof nominalValue.value === 'number' ||
      typeof nominalValue.value === 'boolean'
    ) {
      return nominalValue.value;
    }
    return undefined;
  }
}
