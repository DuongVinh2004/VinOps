import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scanner = path.resolve(process.cwd(), 'scripts/secret-scan.mjs');

function scanFixture(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(tmpdir(), 'vinops-secret-scan-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(root, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf8');
    }
    return spawnSync(process.execPath, [scanner], {
      encoding: 'utf8',
      env: { ...process.env, VINOPS_SECRET_SCAN_ROOT: root },
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe('repository secret scanner', () => {
  it('scans clean evidence text and rejects each isolated credential canary', () => {
    const clean = scanFixture({
      'evidence/VIN-MEGA-002/result.json': JSON.stringify({ password: 'test-only' }),
      'src/config.ts': "export const mode = 'test';\n",
    });
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('2 text file(s) scanned');

    const canaries = [
      ['evidence/VIN-MEGA-002/result.ndjson', `{"key":"${'AK' + 'IA' + 'A'.repeat(16)}"}`],
      ['evidence/VIN-MEGA-002/source.delta.patch', `+token=${'gh' + 'p_' + 'B'.repeat(36)}`],
      ['src/config.ts', `export const api_${'key'} = "${'C'.repeat(20)}";`],
    ] as const;
    for (const [relativePath, content] of canaries) {
      const result = scanFixture({ [relativePath]: content });
      expect(result.status, relativePath).not.toBe(0);
      expect(result.stderr, relativePath).toContain('Secret scan rejected');
    }
  });

  it('fails when the configured scan root cannot be read', () => {
    const missingRoot = path.join(tmpdir(), `vinops-secret-scan-missing-${process.pid}`);
    const result = spawnSync(process.execPath, [scanner], {
      encoding: 'utf8',
      env: { ...process.env, VINOPS_SECRET_SCAN_ROOT: missingRoot },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Secret scan could not complete');
  });
});
