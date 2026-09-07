import { pathToFileURL } from 'node:url';

const repositoryPg = pathToFileURL(
  `${process.cwd().replaceAll('\\', '/')}/packages/database/node_modules/pg/esm/index.mjs`,
).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'pg') {
    return { url: repositoryPg, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
