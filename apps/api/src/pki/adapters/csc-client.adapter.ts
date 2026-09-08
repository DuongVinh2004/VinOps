import { randomUUID } from 'node:crypto';
import { parseCmsSignedData } from '../crypto/cms-signed-data.js';
import type {
  CscAuthorizeRequest,
  CscAuthorizeResponse,
  CscCredentialInfo,
  CscProvider,
  CscProviderConfig,
  CscSignHashRequest,
  CscSignHashResponse,
} from './csc-types.js';

export * from './csc-types.js';
import { MockCscAdapter } from './mock-csc.adapter.js';

/**
 * Base abstract CSC adapter supporting standard Cloud Signature Consortium v1.0.4 API
 */
export abstract class BaseCscAdapter implements CscProvider {
  abstract readonly providerCode: string;

  constructor(protected readonly config: CscProviderConfig) {}

  async listCredentials(userId: string): Promise<CscCredentialInfo[]> {
    const response = await fetch(`${this.config.apiBaseUrl}/csc/v1/credentials/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.clientId ? { Authorization: `Bearer ${this.config.clientId}` } : {}),
      },
      body: JSON.stringify({ userID: userId }),
    });

    if (!response.ok) {
      throw new Error(`CSC credentials/list failed with status ${response.status}`);
    }

    const json = (await response.json()) as { credentialIDs?: string[] };
    const credentialIDs = json.credentialIDs ?? [];
    return Promise.all(credentialIDs.map((id) => this.getCredentialInfo(id)));
  }

  async getCredentialInfo(credentialID: string): Promise<CscCredentialInfo> {
    const response = await fetch(`${this.config.apiBaseUrl}/csc/v1/credentials/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.clientId ? { Authorization: `Bearer ${this.config.clientId}` } : {}),
      },
      body: JSON.stringify({ credentialID, certificates: 'chain', certInfo: true }),
    });

    if (!response.ok) {
      throw new Error(`CSC credentials/info failed with status ${response.status}`);
    }

    return (await response.json()) as CscCredentialInfo;
  }

  async authorize(request: CscAuthorizeRequest): Promise<CscAuthorizeResponse> {
    const response = await fetch(`${this.config.apiBaseUrl}/csc/v1/credentials/authorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.clientId ? { Authorization: `Bearer ${this.config.clientId}` } : {}),
      },
      body: JSON.stringify({
        credentialID: request.credentialID,
        numSignatures: request.numSignatures ?? request.hashes.length,
        hashes: request.hashes,
        clientData: request.clientData,
      }),
    });

    if (!response.ok) {
      throw new Error(`CSC credentials/authorize failed with status ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      transactionID: (data.SAD as string) ?? (data.transactionID as string) ?? randomUUID(),
      challengeType: 'push_app',
      expiresInSeconds: typeof data.expiresIn === 'number' ? data.expiresIn : 180,
      message: 'Vui lòng mở ứng dụng CA để xác nhận ký số.',
    };
  }

  async signHash(request: CscSignHashRequest): Promise<CscSignHashResponse> {
    const response = await fetch(`${this.config.apiBaseUrl}/csc/v1/signatures/signHash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.clientId ? { Authorization: `Bearer ${this.config.clientId}` } : {}),
      },
      body: JSON.stringify({
        credentialID: request.credentialID,
        SAD: request.sad ?? request.transactionID,
        hashes: request.hashes,
        signAlgo: request.signAlgo ?? '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
      }),
    });

    if (!response.ok) {
      throw new Error(`CSC signatures/signHash failed with status ${response.status}`);
    }

    const data = (await response.json()) as { signatures?: string[] };
    const signatures = data.signatures ?? [];
    if (signatures.length === 0) {
      throw new Error('CSC signatures/signHash returned empty signatures array');
    }

    // Validate CMS SignedData DER structure for every signature
    for (const sigB64 of signatures) {
      this.validateCmsSignature(sigB64);
    }

    return {
      signatures,
    };
  }

  protected validateCmsSignature(sigB64: string): void {
    if (!sigB64 || typeof sigB64 !== 'string') {
      throw new Error('Invalid CSC signature response: expected non-empty base64 string');
    }

    const derBuffer = Buffer.from(sigB64, 'base64');
    if (derBuffer.length < 16) {
      throw new Error('Invalid CSC signature response: DER buffer too short');
    }

    // Reject fake text markers
    const textPrefix = derBuffer.subarray(0, 32).toString('utf8');
    if (
      textPrefix.includes('SIGNED[') ||
      textPrefix.includes('MOCK') ||
      textPrefix.includes('TSA_')
    ) {
      throw new Error('Invalid CSC signature response: fake text marker rejected');
    }

    try {
      const parsed = parseCmsSignedData(derBuffer);
      if (parsed.signerInfos.length === 0) {
        throw new Error('Invalid CSC signature response: no signerInfos found in CMS SignedData');
      }
    } catch (err) {
      throw new Error(
        `Invalid CSC signature response: invalid CMS SignedData DER: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

export class VnptSmartCaAdapter extends BaseCscAdapter {
  readonly providerCode = 'vnpt_smartca';
}

export class ViettelCloudCaAdapter extends BaseCscAdapter {
  readonly providerCode = 'viettel_cloud_ca';
}

export class TrustCaAdapter extends BaseCscAdapter {
  readonly providerCode = 'trust_ca';
}

export class CscAdapterFactory {
  static create(providerCode: string, config: CscProviderConfig): CscProvider {
    const isMock = config.isMock || config.apiBaseUrl.includes('mock');

    if (isMock) {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error('Mock CSC signing provider is strictly prohibited in production.');
      }
      return new MockCscAdapter(providerCode, config);
    }

    switch (providerCode) {
      case 'vnpt_smartca':
        return new VnptSmartCaAdapter(config);
      case 'viettel_cloud_ca':
        return new ViettelCloudCaAdapter(config);
      case 'trust_ca':
        return new TrustCaAdapter(config);
      default:
        throw new Error(`Unsupported signing provider: ${providerCode}`);
    }
  }
}
