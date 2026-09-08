import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CscAdapterFactory } from '../src/pki/adapters/csc-client.adapter.js';
import { MockCscAdapter } from '../src/pki/adapters/mock-csc.adapter.js';

describe('CSC Adapter Factory and Security Guard', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns MockCscAdapter in test mode when isMock is true', () => {
    const adapter = CscAdapterFactory.create('vnpt_smartca', {
      apiBaseUrl: 'https://mock.ca.vinops.local',
      isMock: true,
    });
    expect(adapter).toBeInstanceOf(MockCscAdapter);
    expect(adapter.providerCode).toBe('vnpt_smartca');
  });

  it('strictly rejects MockCscAdapter when NODE_ENV is production', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() =>
      CscAdapterFactory.create('vnpt_smartca', {
        apiBaseUrl: 'https://mock.ca.vinops.local',
        isMock: true,
      }),
    ).toThrow(/Mock CSC signing provider is strictly prohibited in production/);
  });

  it('strictly rejects mock URL when NODE_ENV is production even if isMock is omitted', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() =>
      CscAdapterFactory.create('vnpt_smartca', {
        apiBaseUrl: 'https://mock.ca.vinops.local',
      }),
    ).toThrow(/Mock CSC signing provider is strictly prohibited in production/);
  });
});
