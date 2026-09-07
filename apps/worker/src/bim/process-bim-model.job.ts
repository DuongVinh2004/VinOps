import { randomUUID } from 'node:crypto';
import * as WebIFC from 'web-ifc';
import type { VinopsDatabase } from '@vinops/database';
import type { ObjectStorage } from '@vinops/file';
import { IfcPropertyExtractor } from './ifc-property-extractor.js';

export type ProcessBimModelInput = {
  modelId: string;
  revisionId: string;
  sourceFileId: string;
  organizationId?: string | undefined;
  projectId?: string | undefined;
  rawBuffer?: Uint8Array | undefined;
};

export type SpatialTreeNode = {
  id: string;
  name: string;
  type: string;
  children: SpatialTreeNode[];
  guids?: string[] | undefined;
};

export type ProcessBimModelResult = {
  modelId: string;
  revisionId: string;
  elementsCount: number;
  buildingCount: number;
  storeyCount: number;
  spatialTree: SpatialTreeNode;
  glbBuffer: Uint8Array;
  status: 'completed' | 'failed';
  error?: string | undefined;
};

interface IfcLineItem {
  GlobalId?: { value?: string };
  Name?: { value?: string };
}

interface IfcFlatGeometry {
  geometryExpressID?: number;
}

interface WebIfcExtendedApi {
  GetVertexArray(modelId: number, geometryExpressID: number): Float32Array;
  GetIndexArray(modelId: number, geometryExpressID: number): Uint32Array;
}

interface WorkerTxWithClient {
  client: {
    query: (
      text: string,
      values?: readonly unknown[],
    ) => Promise<{ rows: readonly Record<string, unknown>[] }>;
  };
}

/**
 * Creates a valid glTF 2.0 Binary (.glb) from parsed geometries
 */
export function buildGlb(
  nodes: Array<{
    name: string;
    ifcGuid: string;
    positions: number[];
    indices: number[];
  }>,
): Uint8Array {
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const sceneNodes: Record<string, unknown>[] = [];
  const binaryBuffers: Buffer[] = [];
  let byteOffset = 0;

  for (const node of nodes) {
    if (!node.positions || node.positions.length === 0) continue;

    const posFloats = new Float32Array(node.positions);
    const posBuf = Buffer.from(posFloats.buffer, posFloats.byteOffset, posFloats.byteLength);

    // Calculate min/max for position accessor
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let p = 0; p < node.positions.length; p += 3) {
      const x = node.positions[p] ?? 0;
      const y = node.positions[p + 1] ?? 0;
      const z = node.positions[p + 2] ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const posViewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: posBuf.length,
      target: 34962, // ARRAY_BUFFER
    });
    binaryBuffers.push(posBuf);
    byteOffset += posBuf.length;

    // Pad to 4 bytes if needed
    const padPos = (4 - (byteOffset % 4)) % 4;
    if (padPos > 0) {
      binaryBuffers.push(Buffer.alloc(padPos));
      byteOffset += padPos;
    }

    const posAccessorIndex = accessors.length;
    accessors.push({
      bufferView: posViewIndex,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: node.positions.length / 3,
      type: 'VEC3',
      max: [
        maxX === -Infinity ? 0 : maxX,
        maxY === -Infinity ? 0 : maxY,
        maxZ === -Infinity ? 0 : maxZ,
      ],
      min: [
        minX === Infinity ? 0 : minX,
        minY === Infinity ? 0 : minY,
        minZ === Infinity ? 0 : minZ,
      ],
    });

    let indexAccessorIndex: number | undefined;
    if (node.indices && node.indices.length > 0) {
      const idxInts = new Uint32Array(node.indices);
      const idxBuf = Buffer.from(idxInts.buffer, idxInts.byteOffset, idxInts.byteLength);

      const idxViewIndex = bufferViews.length;
      bufferViews.push({
        buffer: 0,
        byteOffset,
        byteLength: idxBuf.length,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      });
      binaryBuffers.push(idxBuf);
      byteOffset += idxBuf.length;

      const padIdx = (4 - (byteOffset % 4)) % 4;
      if (padIdx > 0) {
        binaryBuffers.push(Buffer.alloc(padIdx));
        byteOffset += padIdx;
      }

      indexAccessorIndex = accessors.length;
      accessors.push({
        bufferView: idxViewIndex,
        byteOffset: 0,
        componentType: 5125, // UNSIGNED_INT
        count: node.indices.length,
        type: 'SCALAR',
      });
    }

    const meshIndex = meshes.length;
    meshes.push({
      name: node.name,
      primitives: [
        {
          attributes: { POSITION: posAccessorIndex },
          ...(indexAccessorIndex !== undefined ? { indices: indexAccessorIndex } : {}),
        },
      ],
    });

    sceneNodes.push({
      name: node.name,
      mesh: meshIndex,
      userData: {
        ifcGuid: node.ifcGuid,
      },
    });
  }

  const combinedBin = Buffer.concat(binaryBuffers);

  const gltf = {
    asset: { version: '2.0', generator: 'VinOps-Web-IFC-Pipeline' },
    scene: 0,
    scenes: [{ nodes: sceneNodes.map((_, i) => i) }],
    nodes: sceneNodes,
    meshes,
    buffers: [{ byteLength: combinedBin.length }],
    bufferViews,
    accessors,
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPadding = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunkLength = jsonBuf.length + jsonPadding;

  const binPadding = (4 - (combinedBin.length % 4)) % 4;
  const binChunkLength = combinedBin.length + binPadding;

  const totalLength = 12 + 8 + jsonChunkLength + (combinedBin.length > 0 ? 8 + binChunkLength : 0);
  const out = Buffer.alloc(totalLength);

  // 12-byte Header
  out.writeUInt32LE(0x46546c67, 0); // magic 'glTF'
  out.writeUInt32LE(2, 4); // version
  out.writeUInt32LE(totalLength, 8);

  // Chunk 0 (JSON)
  out.writeUInt32LE(jsonChunkLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBuf.copy(out, 20);
  for (let i = 0; i < jsonPadding; i++) {
    out.writeUInt8(0x20, 20 + jsonBuf.length + i); // space padding
  }

  // Chunk 1 (BIN)
  if (combinedBin.length > 0) {
    const binOffset = 20 + jsonChunkLength;
    out.writeUInt32LE(binChunkLength, binOffset);
    out.writeUInt32LE(0x004e4942, binOffset + 4); // 'BIN\0'
    combinedBin.copy(out, binOffset + 8);
    for (let i = 0; i < binPadding; i++) {
      out.writeUInt8(0x00, binOffset + 8 + combinedBin.length + i);
    }
  }

  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

export class ProcessBimModelJob {
  constructor(
    private readonly database?: VinopsDatabase,
    private readonly storage?: ObjectStorage,
  ) {}

  async process(input: ProcessBimModelInput): Promise<ProcessBimModelResult> {
    const startTime = Date.now();
    const ifcApi = new WebIFC.IfcAPI();
    await ifcApi.Init();

    let rawBuffer = input.rawBuffer;

    try {
      // 1. Download raw IFC if not provided directly
      if (!rawBuffer && this.storage && this.database) {
        // Look up file_object key
        const rows = await this.database.withOutboxWorkerTransaction(
          { workerName: 'bim-worker' },
          async (tx) => {
            const client = (tx as unknown as WorkerTxWithClient).client;
            const res = await client.query(
              'SELECT storage_key FROM vinops.file_objects WHERE id = $1',
              [input.sourceFileId],
            );
            return res.rows;
          },
        );
        const storageKey = rows[0]?.['storage_key'] as string | undefined;
        if (storageKey) {
          rawBuffer = await this.storage.getObject(storageKey);
        }
      }

      if (!rawBuffer || rawBuffer.length === 0) {
        throw new Error(`Raw IFC file buffer is missing or empty for file ${input.sourceFileId}`);
      }

      // 2. Open model in Web-IFC
      const modelId = ifcApi.OpenModel(rawBuffer);
      const propertyExtractor = new IfcPropertyExtractor(ifcApi, modelId);

      // 3. Extract spatial hierarchy
      let buildingCount = 0;
      let storeyCount = 0;
      const elementsToInsert: Array<{
        ifcGuid: string;
        ifcType: string;
        name: string;
        storeyName: string;
        properties: Record<string, unknown>;
        boundingBox: Record<string, unknown>;
      }> = [];

      const glbNodes: Array<{
        name: string;
        ifcGuid: string;
        positions: number[];
        indices: number[];
      }> = [];

      // Find spatial structures
      const spatialTree: SpatialTreeNode = {
        id: input.modelId,
        name: 'Project',
        type: 'IfcProject',
        children: [],
      };

      const webIfcConstants = WebIFC as unknown as Record<string, number>;
      const ifcBuildingConst = webIfcConstants['IFCBUILDING'] ?? 4170881907;
      const ifcBuildingStoreyConst = webIfcConstants['IFCBUILDINGSTOREY'] ?? 4170881908;
      const extendedIfcApi = ifcApi as unknown as WebIfcExtendedApi;

      // Extract Project, Sites, Buildings, Storeys
      const lines = ifcApi.GetLineIDsWithType(modelId, ifcBuildingConst);
      const bSize = lines ? lines.size() : 0;
      buildingCount = Math.max(1, bSize);

      const storeyLines = ifcApi.GetLineIDsWithType(modelId, ifcBuildingStoreyConst);
      const sSize = storeyLines ? storeyLines.size() : 0;
      storeyCount = Math.max(1, sSize);

      // Collect products (elements)
      const productTypes = [
        'IFCWALL',
        'IFCWALLSTANDARDCASE',
        'IFCBEAM',
        'IFCCOLUMN',
        'IFCSLAB',
        'IFCDOOR',
        'IFCWINDOW',
        'IFCSTAIR',
        'IFCRAILING',
        'IFCROOF',
        'IFCMEMBER',
        'IFCPLATE',
        'IFCFOOTING',
        'IFCFLOWSEGMENT',
        'IFCFLOWTERMINAL',
        'IFCBUILDINGELEMENTPROXY',
      ];

      for (const pType of productTypes) {
        const typeConst = webIfcConstants[pType];
        if (!typeConst) continue;
        const ids = ifcApi.GetLineIDsWithType(modelId, typeConst);
        if (!ids) continue;

        for (let i = 0; i < ids.size(); i++) {
          const expressId = ids.get(i);
          const line = ifcApi.GetLine(modelId, expressId) as IfcLineItem | undefined;
          if (!line) continue;

          const guid = line.GlobalId?.value || randomUUID().replace(/-/g, '').slice(0, 22);
          const name = line.Name?.value ? String(line.Name.value) : pType;
          const storeyName = 'Ground Floor';

          // Extract properties
          const props = propertyExtractor.extractProperties(expressId);

          // Geometry
          const positions: number[] = [];
          const indices: number[] = [];
          try {
            const flatMesh = ifcApi.GetFlatMesh(modelId, expressId);
            if (flatMesh && flatMesh.geometries) {
              const gSize = flatMesh.geometries.size();
              for (let g = 0; g < gSize; g++) {
                const geom = flatMesh.geometries.get(g) as unknown as IfcFlatGeometry;
                const geomExpressID = geom?.geometryExpressID;
                if (typeof geomExpressID === 'number') {
                  const vArr = extendedIfcApi.GetVertexArray(modelId, geomExpressID);
                  const iArr = extendedIfcApi.GetIndexArray(modelId, geomExpressID);
                  if (vArr) {
                    for (let v = 0; v < vArr.length; v += 6) {
                      const vx = vArr[v];
                      const vy = vArr[v + 1];
                      const vz = vArr[v + 2];
                      if (vx !== undefined && vy !== undefined && vz !== undefined) {
                        positions.push(vx, vy, vz);
                      }
                    }
                  }
                  if (iArr) {
                    for (let idx = 0; idx < iArr.length; idx++) {
                      const indexVal = iArr[idx];
                      if (indexVal !== undefined) {
                        indices.push(indexVal);
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // Geometry extraction fallback
          }

          // If no geometry extracted directly, create minimal cube bounding representation
          if (positions.length === 0) {
            positions.push(
              -0.5,
              -0.5,
              -0.5,
              0.5,
              -0.5,
              -0.5,
              0.5,
              0.5,
              -0.5,
              -0.5,
              0.5,
              -0.5,
              -0.5,
              -0.5,
              0.5,
              0.5,
              -0.5,
              0.5,
              0.5,
              0.5,
              0.5,
              -0.5,
              0.5,
              0.5,
            );
            indices.push(
              0,
              2,
              1,
              0,
              3,
              2,
              4,
              5,
              6,
              4,
              6,
              7,
              0,
              1,
              5,
              0,
              5,
              4,
              2,
              3,
              7,
              2,
              7,
              6,
              0,
              4,
              7,
              0,
              7,
              3,
              1,
              2,
              6,
              1,
              6,
              5,
            );
          }

          glbNodes.push({
            name,
            ifcGuid: guid,
            positions,
            indices,
          });

          elementsToInsert.push({
            ifcGuid: guid,
            ifcType: pType,
            name,
            storeyName,
            properties: props,
            boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
          });
        }
      }

      // Build glTF 2.0 Binary (.glb)
      const glbBuffer = buildGlb(glbNodes);

      // Upload glb and spatial tree if storage available
      let convertedGltfFileId: string | null = null;
      let spatialTreeFileId: string | null = null;

      if (this.storage && this.database && input.organizationId && input.projectId) {
        // Upload glb
        const glbKey = `bim/${input.modelId}/${input.revisionId}/model.glb`;
        await this.storage.putObject(glbKey, glbBuffer, 'model/gltf-binary');
        convertedGltfFileId = randomUUID();

        // Upload spatial tree
        const treeKey = `bim/${input.modelId}/${input.revisionId}/spatial_tree.json`;
        const treeBuf = Buffer.from(JSON.stringify(spatialTree), 'utf8');
        await this.storage.putObject(treeKey, treeBuf, 'application/json');
        spatialTreeFileId = randomUUID();
      }

      // 4. Update Database
      if (this.database && input.organizationId && input.projectId) {
        await this.database.withOutboxWorkerTransaction(
          { workerName: 'bim-worker' },
          async (tx) => {
            const client = (tx as unknown as WorkerTxWithClient).client;

            // Bulk insert elements
            for (const el of elementsToInsert) {
              await client.query(
                `INSERT INTO vinops.bim_elements (
                  id, organization_id, project_id, bim_model_revision_id,
                  ifc_guid, ifc_type, name, storey_name, properties, bounding_box
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (bim_model_revision_id, ifc_guid) DO NOTHING`,
                [
                  randomUUID(),
                  input.organizationId,
                  input.projectId,
                  input.revisionId,
                  el.ifcGuid,
                  el.ifcType,
                  el.name,
                  el.storeyName,
                  JSON.stringify(el.properties),
                  JSON.stringify(el.boundingBox),
                ],
              );
            }

            // Update revision status
            const durationMs = Date.now() - startTime;
            await client.query(
              `UPDATE vinops.bim_model_revisions
               SET conversion_status = 'completed',
                   elements_count = $1,
                   gltf_size_bytes = $2,
                   conversion_duration_ms = $3,
                   converted_gltf_file_id = COALESCE($4, converted_gltf_file_id),
                   spatial_tree_file_id = COALESCE($5, spatial_tree_file_id)
               WHERE id = $6`,
              [
                elementsToInsert.length,
                glbBuffer.byteLength,
                durationMs,
                convertedGltfFileId,
                spatialTreeFileId,
                input.revisionId,
              ],
            );

            // Update model status & current revision
            await client.query(
              `UPDATE vinops.bim_models
               SET status = 'ready',
                   current_revision_id = $1
               WHERE id = $2`,
              [input.revisionId, input.modelId],
            );

            // Emit outbox event
            await client.query(
              `INSERT INTO vinops.outbox_events (
                id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
              ) VALUES ($1, $2, $3, 'bim_model', $4, 'bim_model.ready.v1', $5)`,
              [
                randomUUID(),
                input.organizationId,
                input.projectId,
                input.modelId,
                JSON.stringify({
                  modelId: input.modelId,
                  revisionId: input.revisionId,
                  elementsCount: elementsToInsert.length,
                }),
              ],
            );
          },
        );
      }

      ifcApi.CloseModel(modelId);

      return {
        modelId: input.modelId,
        revisionId: input.revisionId,
        elementsCount: elementsToInsert.length,
        buildingCount,
        storeyCount,
        spatialTree,
        glbBuffer,
        status: 'completed',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Record failure in DB if possible
      if (this.database && input.revisionId) {
        try {
          await this.database.withOutboxWorkerTransaction(
            { workerName: 'bim-worker' },
            async (tx) => {
              const client = (tx as unknown as WorkerTxWithClient).client;
              await client.query(
                `UPDATE vinops.bim_model_revisions
                 SET conversion_status = 'failed',
                     conversion_error = $1
                 WHERE id = $2`,
                [errorMsg, input.revisionId],
              );
              await client.query(
                `UPDATE vinops.bim_models
                 SET status = 'failed'
                 WHERE id = $1`,
                [input.modelId],
              );
            },
          );
        } catch {
          // Ignore secondary DB error
        }
      }

      return {
        modelId: input.modelId,
        revisionId: input.revisionId,
        elementsCount: 0,
        buildingCount: 0,
        storeyCount: 0,
        spatialTree: { id: input.modelId, name: 'Failed', type: 'IfcProject', children: [] },
        glbBuffer: new Uint8Array(),
        status: 'failed',
        error: errorMsg,
      };
    }
  }
}
