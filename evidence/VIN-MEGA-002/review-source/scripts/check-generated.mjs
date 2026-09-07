import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const schemaPath = path.join(
  repositoryRoot,
  'packages',
  'contracts',
  'openapi',
  'vinops.openapi.yaml',
);
const generatedPath = path.join(
  repositoryRoot,
  'packages',
  'contracts',
  'src',
  'generated',
  'openapi.ts',
);

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function generateContract() {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) {
    throw new Error('Run this check through pnpm so the pinned package manager is used.');
  }

  const result = spawnSync(process.execPath, [pnpmCli, 'exec', 'openapi-typescript', schemaPath], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const diagnostic = result.stderr.toString('utf8').trim().slice(0, 2_000);
    throw new Error(
      `Contract generation exited with ${String(result.status)}${diagnostic ? `: ${diagnostic}` : '.'}`,
    );
  }
  if (result.stdout.length === 0) {
    throw new Error('Contract generation produced no output.');
  }

  return result.stdout;
}

let committed;
try {
  committed = readFileSync(generatedPath);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Generated contract is unavailable: ${message}`);
  console.error('Run "pnpm contracts:generate" and review the generated file.');
  process.exitCode = 1;
}

if (committed) {
  try {
    const firstGeneration = generateContract();
    const secondGeneration = generateContract();

    if (!firstGeneration.equals(secondGeneration)) {
      console.error('OpenAPI type generation is not deterministic across two identical runs.');
      console.error(`first_sha256=${digest(firstGeneration)}`);
      console.error(`second_sha256=${digest(secondGeneration)}`);
      process.exitCode = 1;
    } else if (!committed.equals(firstGeneration)) {
      console.error('Generated OpenAPI types have drifted from the contract.');
      console.error(`committed_sha256=${digest(committed)}`);
      console.error(`regenerated_sha256=${digest(firstGeneration)}`);
      console.error('Run "pnpm contracts:generate" and review the generated diff.');
      process.exitCode = 1;
    } else {
      console.log(`Generated contract is deterministic and current: sha256=${digest(committed)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Generated contract check failed: ${message}`);
    process.exitCode = 1;
  }
}
