import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const deniedLicense =
  /\b(?:AGPL|GPL|SSPL)(?:-[0-9.]+)?(?:-only|-or-later)?\b|\bRSAL(?:v?[0-9.]+|-[0-9.]+)?\b/i;
const permittedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'PostgreSQL',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);
const permittedExceptions = new Set(['LLVM-exception']);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function workspaceManifestPaths() {
  const manifestPaths = [path.join(repositoryRoot, 'package.json')];
  for (const scope of ['apps', 'packages']) {
    const scopePath = path.join(repositoryRoot, scope);
    if (!existsSync(scopePath)) {
      continue;
    }
    const entries = readdirSync(scopePath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      const manifestPath = path.join(scopePath, entry.name, 'package.json');
      if (existsSync(manifestPath)) {
        manifestPaths.push(manifestPath);
      }
    }
  }
  return manifestPaths;
}

function resolveInstalledManifest(dependencyName, manifestDirectory) {
  const dependencySegments = dependencyName.split('/');
  for (
    let currentDirectory = manifestDirectory;
    currentDirectory.startsWith(repositoryRoot);
    currentDirectory = path.dirname(currentDirectory)
  ) {
    const candidate = path.join(
      currentDirectory,
      'node_modules',
      ...dependencySegments,
      'package.json',
    );
    if (existsSync(candidate)) {
      return candidate;
    }
    if (currentDirectory === repositoryRoot) {
      break;
    }
  }

  const resolver = createRequire(path.join(manifestDirectory, '__vinops_license_check__.cjs'));
  try {
    return resolver.resolve(`${dependencyName}/package.json`);
  } catch {
    let entryPoint;
    try {
      entryPoint = resolver.resolve(dependencyName);
    } catch {
      return undefined;
    }

    let currentDirectory = path.dirname(entryPoint);
    while (currentDirectory !== path.dirname(currentDirectory)) {
      const candidate = path.join(currentDirectory, 'package.json');
      if (existsSync(candidate)) {
        const candidateManifest = readJson(candidate);
        if (candidateManifest.name === dependencyName) {
          return candidate;
        }
      }
      currentDirectory = path.dirname(currentDirectory);
    }
    return undefined;
  }
}

function licenseExpression(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license.trim();
  }
  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type.trim();
  }
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((license) => (typeof license === 'string' ? license : license?.type))
      .filter((license) => typeof license === 'string' && license.length > 0);
    return values.join(' OR ');
  }
  return '';
}

function validateLicense(expression) {
  if (!expression) {
    return 'license is missing';
  }
  if (deniedLicense.test(expression)) {
    return `license ${expression} is denied by policy`;
  }
  if (/SEE LICENSE|UNLICENSED|UNKNOWN|CUSTOM|PROPRIETARY/i.test(expression)) {
    return `license ${expression} is not an approved SPDX expression`;
  }

  const tokens = expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:AND|OR|WITH)\s+/i)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return `license ${expression} could not be parsed`;
  }
  const unknownTokens = tokens.filter(
    (token) => !permittedLicenses.has(token) && !permittedExceptions.has(token),
  );
  if (unknownTokens.length > 0) {
    return `license token(s) ${unknownTokens.join(', ')} require review`;
  }
  return undefined;
}

const records = [];
const failures = [];

try {
  for (const manifestPath of workspaceManifestPaths()) {
    const manifest = readJson(manifestPath);
    const manifestDirectory = path.dirname(manifestPath);
    const declaredBy = path.relative(repositoryRoot, manifestPath).replaceAll(path.sep, '/');

    for (const dependencyGroup of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const dependencies = manifest[dependencyGroup] ?? {};
      for (const [dependencyName, declaredVersion] of Object.entries(dependencies)) {
        if (typeof declaredVersion !== 'string') {
          failures.push(`${declaredBy}: ${dependencyName} has a non-string version declaration`);
          continue;
        }
        if (declaredVersion.startsWith('workspace:')) {
          continue;
        }
        if (!exactVersion.test(declaredVersion)) {
          failures.push(
            `${declaredBy}: ${dependencyName}@${declaredVersion} is not an exact direct version`,
          );
          continue;
        }

        const installedManifestPath = resolveInstalledManifest(dependencyName, manifestDirectory);
        if (!installedManifestPath) {
          failures.push(`${declaredBy}: ${dependencyName}@${declaredVersion} is not installed`);
          continue;
        }

        const installedManifest = readJson(installedManifestPath);
        if (installedManifest.version !== declaredVersion) {
          failures.push(
            `${declaredBy}: ${dependencyName} resolved to ${String(installedManifest.version)} instead of ${declaredVersion}`,
          );
          continue;
        }

        const license = licenseExpression(installedManifest);
        const licenseFailure = validateLicense(license);
        if (licenseFailure) {
          failures.push(`${declaredBy}: ${dependencyName}@${declaredVersion}: ${licenseFailure}`);
          continue;
        }
        records.push({
          declaredBy,
          license,
          name: dependencyName,
          version: declaredVersion,
        });
      }
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`license inventory could not complete: ${message}`);
}

records.sort(
  (left, right) =>
    left.name.localeCompare(right.name, 'en') ||
    left.version.localeCompare(right.version, 'en') ||
    left.declaredBy.localeCompare(right.declaredBy, 'en'),
);
failures.sort((left, right) => left.localeCompare(right, 'en'));

if (failures.length > 0) {
  console.error(`License policy rejected ${failures.length} direct dependency declaration(s).`);
  for (const failure of failures) {
    console.error(failure);
  }
  process.exitCode = 1;
} else {
  console.log(`License policy passed for ${records.length} direct dependency declaration(s).`);
  for (const record of records) {
    console.log(`${record.name}@${record.version} | ${record.license} | ${record.declaredBy}`);
  }
}
