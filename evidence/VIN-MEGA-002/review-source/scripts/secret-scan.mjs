import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

const excludedDirectories = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.pnpm-store',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'storybook-static',
]);
const excludedArchiveExtensions = new Set([
  '.7z',
  '.br',
  '.bz2',
  '.gz',
  '.jar',
  '.rar',
  '.tar',
  '.tgz',
  '.war',
  '.zip',
]);

const fixedRules = [
  {
    id: 'private-key',
    expression: new RegExp(
      ['-----BEGIN ', '(?:(?:RSA|DSA|EC|OPENSSH|PGP) )?', 'PRIVATE KEY-----'].join(''),
      'g',
    ),
  },
  { id: 'aws-access-key', expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', expression: /\bgh[oprsu]_[A-Za-z0-9]{36,}\b/g },
  { id: 'gitlab-token', expression: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-api-key', expression: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'npm-token', expression: /\bnpm_[A-Za-z0-9]{36,}\b/g },
  { id: 'slack-token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { id: 'stripe-live-key', expression: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  {
    id: 'credentialed-uri',
    expression:
      /\b(?:amqps?|mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/[^:\s/]+:([^@\s/]+)@/gi,
  },
  {
    id: 'jwt',
    expression: /\beyJ[A-Za-z0-9_-]{17,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  },
  { id: 'azure-account-key', expression: /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}\b/g },
];

const credentialAssignment =
  /\b(password|passwd|pwd|secret|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\b\s*[:=]\s*["'`]([^"'`\r\n]{8,})["'`]/gi;

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  if (/^(?:<[^>]+>|\[[^\]]+\]|\$\{[^}]+\})$/.test(normalized)) {
    return true;
  }
  if (/^(?:test|fake|example|dummy|fixture)[-_]/.test(normalized)) {
    return true;
  }
  return [
    'changeme',
    'dummy',
    'example',
    'fake',
    'fixture',
    'local-only',
    'not-a-real',
    'not-a-secret',
    'placeholder',
    'replace-me',
    'replace_me',
    'replace-with',
    'sample',
    'test-only',
  ].some((marker) => normalized.includes(marker));
}

function lineNumberAt(content, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

async function collectFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name.toLowerCase())) {
        files.push(...(await collectFiles(absolutePath, relativePath)));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

const findings = [];
let scannedFiles = 0;
let excludedFiles = 0;

try {
  const files = await collectFiles(repositoryRoot);
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    if (excludedArchiveExtensions.has(extension)) {
      excludedFiles += 1;
      continue;
    }

    const bytes = await readFile(file.absolutePath);
    if (bytes.includes(0)) {
      excludedFiles += 1;
      continue;
    }

    scannedFiles += 1;
    const content = bytes.toString('utf8');
    for (const rule of fixedRules) {
      rule.expression.lastIndex = 0;
      for (const match of content.matchAll(rule.expression)) {
        if (rule.id === 'credentialed-uri' && isPlaceholder(match[1] ?? '')) {
          continue;
        }
        findings.push({
          file: file.relativePath,
          line: lineNumberAt(content, match.index),
          rule: rule.id,
        });
      }
    }

    credentialAssignment.lastIndex = 0;
    for (const match of content.matchAll(credentialAssignment)) {
      if (!isPlaceholder(match[2])) {
        findings.push({
          file: file.relativePath,
          line: lineNumberAt(content, match.index),
          rule: 'hardcoded-credential',
        });
      }
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Secret scan could not complete: ${message}`);
  process.exitCode = 1;
}

if (findings.length > 0) {
  findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file, 'en') ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule, 'en'),
  );
  console.error(`Secret scan rejected ${findings.length} potential credential occurrence(s).`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
  }
  console.error('Potential secret values are intentionally omitted from this report.');
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(
    `Secret scan passed: ${scannedFiles} text file(s) scanned; ${excludedFiles} archive or binary file(s) excluded.`,
  );
}
