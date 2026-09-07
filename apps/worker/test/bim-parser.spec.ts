import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProcessBimModelJob, buildGlb } from '../src/bim/process-bim-model.job.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(currentDir, 'fixtures/sample-cube.ifc');

describe('Web-IFC Worker Job & Parser', () => {
  it('parses sample-cube.ifc, extracts hierarchy, and builds glTF 2.0 binary', async () => {
    const rawBuffer = await readFile(fixturePath);
    const job = new ProcessBimModelJob();

    const result = await job.process({
      modelId: '550e8400-e29b-41d4-a716-446655440001',
      revisionId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      sourceFileId: 'f9e8d7c6-b5a4-4321-1234-56789abcdef0',
      rawBuffer: new Uint8Array(rawBuffer),
    });

    expect(result.status).toBe('completed');
    expect(result.buildingCount).toBeGreaterThanOrEqual(1);
    expect(result.storeyCount).toBeGreaterThanOrEqual(1);
    expect(result.elementsCount).toBeGreaterThanOrEqual(1);

    // Verify glTF 2.0 Binary magic header 0x46546C67 ('glTF')
    expect(result.glbBuffer.byteLength).toBeGreaterThan(12);
    const view = new DataView(
      result.glbBuffer.buffer,
      result.glbBuffer.byteOffset,
      result.glbBuffer.byteLength,
    );
    const magic = view.getUint32(0, true);
    const version = view.getUint32(4, true);
    expect(magic).toBe(0x46546c67);
    expect(version).toBe(2);
  });

  it('buildGlb correctly packages mesh nodes with ifcGuid userData', () => {
    const glb = buildGlb([
      {
        name: 'Test Beam',
        ifcGuid: '3B4c8x$vD7A8mK1_eQ0zW1',
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
        indices: [0, 1, 2],
      },
    ]);

    expect(glb.byteLength).toBeGreaterThan(20);
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);

    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    expect(jsonChunkType).toBe(0x4e4f534a); // 'JSON'

    const jsonBytes = glb.subarray(20, 20 + jsonChunkLength);
    const jsonStr = new TextDecoder().decode(jsonBytes).trim();
    const parsedGltf = JSON.parse(jsonStr) as {
      asset: { version: string };
      nodes: Array<{ userData: { ifcGuid: string } }>;
    };

    expect(parsedGltf.asset.version).toBe('2.0');
    expect(parsedGltf.nodes[0]?.userData.ifcGuid).toBe('3B4c8x$vD7A8mK1_eQ0zW1');
  });
});
