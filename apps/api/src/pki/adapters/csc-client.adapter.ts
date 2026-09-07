import { createHash, randomUUID } from 'node:crypto';

export type CscCertificateDetails = {
  subjectDN: string;
  issuerDN: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
};

export type CscCredentialInfo = {
  credentialID: string;
  description: string;
  keyAlgorithm: string;
  keyLength: number;
  cert: CscCertificateDetails;
  status: 'active' | 'expired' | 'revoked' | 'suspended';
};

export type CscAuthorizeRequest = {
  credentialID: string;
  numSignatures?: number;
  hashes: string[];
  authMode?: 'push_notification' | 'otp' | 'pin';
  clientData?: string;
};

export type CscAuthorizeResponse = {
  transactionID: string;
  challengeType: 'push_app' | 'otp';
  expiresInSeconds: number;
  message: string;
};

export type CscSignHashRequest = {
  credentialID: string;
  transactionID: string;
  sad?: string; // Signature Activation Data (OTP / PIN)
  hashes: string[];
  signAlgo?: string;
};

export type CscSignHashResponse = {
  signatures: string[]; // Base64 encoded CAdES / CMS signatures
};

export interface CscProvider {
  readonly providerCode: string;
  listCredentials(userId: string): Promise<CscCredentialInfo[]>;
  getCredentialInfo(credentialID: string): Promise<CscCredentialInfo>;
  authorize(request: CscAuthorizeRequest): Promise<CscAuthorizeResponse>;
  signHash(request: CscSignHashRequest): Promise<CscSignHashResponse>;
}

export type CscProviderConfig = {
  apiBaseUrl: string;
  clientId?: string;
  clientSecret?: string;
  isMock?: boolean;
};

/**
 * Base abstract CSC adapter supporting standard Cloud Signature Consortium v1.0.4 API
 */
export abstract class BaseCscAdapter implements CscProvider {
  abstract readonly providerCode: string;

  constructor(protected readonly config: CscProviderConfig) {}

  async listCredentials(userId: string): Promise<CscCredentialInfo[]> {
    if (this.config.isMock || this.config.apiBaseUrl.includes('mock')) {
      return [this.createMockCredential(userId)];
    }

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
    if (this.config.isMock || this.config.apiBaseUrl.includes('mock')) {
      return this.createMockCredential(credentialID);
    }

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
    if (this.config.isMock || this.config.apiBaseUrl.includes('mock')) {
      const txnId = `${this.providerCode.toUpperCase()}-TXN-${randomUUID().slice(0, 8)}`;
      return {
        transactionID: txnId,
        challengeType: request.authMode === 'push_notification' ? 'push_app' : 'otp',
        expiresInSeconds: 180,
        message: `Yêu cầu ký số gửi tới ứng dụng ${this.providerCode}. Vui lòng xác thực giao dịch.`,
      };
    }

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
    if (this.config.isMock || this.config.apiBaseUrl.includes('mock')) {
      // Deterministic mock signature generation
      const signatures = request.hashes.map((hash) => {
        const mockSigPayload = `SIGNED[${this.providerCode}]:${request.credentialID}:${hash}:${request.sad ?? 'PIN_APPROVED'}`;
        return Buffer.from(createHash('sha256').update(mockSigPayload).digest()).toString('base64');
      });
      return { signatures };
    }

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
    return {
      signatures: data.signatures ?? [],
    };
  }

  protected createMockCredential(idOrUser: string): CscCredentialInfo {
    const serial = createHash('sha256')
      .update(`${this.providerCode}:${idOrUser}`)
      .digest('hex')
      .slice(0, 32)
      .toUpperCase();

    const notBefore = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

    return {
      credentialID: idOrUser,
      description: `Chứng thư số Cloud CA - ${this.providerCode}`,
      keyAlgorithm: 'RSA',
      keyLength: 2048,
      status: 'active',
      cert: {
        subjectDN: `CN=KY SU XAY DUNG, O=NHA THAU VINOPS, C=VN`,
        issuerDN: `CN=${this.providerCode.toUpperCase()} Root CA, O=NHA MANG CA, C=VN`,
        serialNumber: serial,
        notBefore,
        notAfter,
      },
    };
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
