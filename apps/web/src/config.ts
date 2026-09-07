import { loadWebConfig, type WebConfig } from '@vinops/config';

export function readPublicConfig(environment: Record<string, unknown>): WebConfig {
  return loadWebConfig(environment);
}
