import { generateKeyPairSync, randomUUID, type KeyObject, type X509Certificate } from 'node:crypto';
import { createTestX509Certificate } from '../crypto/certificate-chain.js';
import { createCmsSignedData } from '../crypto/cms-signed-data.js';
import type {
  CscAuthorizeRequest,
  CscAuthorizeResponse,
  CscCredentialInfo,
  CscProvider,
  CscProviderConfig,
  CscSignHashRequest,
  CscSignHashResponse,
} from './csc-types.js';

export class MockCscAdapter implements CscProvider {
  private mockKeys: { privateKey: KeyObject; certificate: X509Certificate } | undefined;

  constructor(
    readonly providerCode: string,
    protected readonly config: CscProviderConfig,
  ) {}

  private getMockKeys(): { privateKey: KeyObject; certificate: X509Certificate } {
    if (!this.mockKeys) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const serialBigInt = BigInt(`0x${randomUUID().replace(/-/g, '').slice(0, 16)}`);
      const { certificate } = createTestX509Certificate({
        subjectCommonName: `Kỹ sư VinOps (${this.providerCode.toUpperCase()})`,
        issuerCommonName: `${this.providerCode.toUpperCase()} Root CA (MOCK)`,
        publicKey,
        issuerPrivateKey: privateKey,
        serialNumber: serialBigInt,
      });
      this.mockKeys = { privateKey, certificate };
    }
    return this.mockKeys;
  }

  listCredentials(userId: string): Promise<CscCredentialInfo[]> {
    return Promise.resolve([this.createMockCredential(userId)]);
  }

  getCredentialInfo(credentialID: string): Promise<CscCredentialInfo> {
    return Promise.resolve(this.createMockCredential(credentialID));
  }

  authorize(request: CscAuthorizeRequest): Promise<CscAuthorizeResponse> {
    const txnId = `${this.providerCode.toUpperCase()}-TXN-${randomUUID().slice(0, 8)}`;
    return Promise.resolve({
      transactionID: txnId,
      challengeType: request.authMode === 'push_notification' ? 'push_app' : 'otp',
      expiresInSeconds: 180,
      message: `[MOCK] Yêu cầu ký số gửi tới ứng dụng ${this.providerCode}. Vui lòng xác thực giao dịch.`,
    });
  }

  signHash(request: CscSignHashRequest): Promise<CscSignHashResponse> {
    const { privateKey, certificate } = this.getMockKeys();
    const signatures = request.hashes.map((hash) => {
      const cmsDer = createCmsSignedData({
        documentHashHex: hash,
        signerCertificate: certificate,
        signerPrivateKey: privateKey,
      });
      return cmsDer.toString('base64');
    });
    return Promise.resolve({ signatures });
  }

  protected createMockCredential(idOrUser: string): CscCredentialInfo {
    const { certificate } = this.getMockKeys();
    return {
      credentialID: idOrUser,
      description: `[MOCK] Chứng thư số Cloud CA - ${this.providerCode}`,
      keyAlgorithm: 'RSA',
      keyLength: 2048,
      status: 'active',
      cert: {
        subjectDN: certificate.subject,
        issuerDN: certificate.issuer,
        serialNumber: certificate.serialNumber,
        notBefore: certificate.validFrom,
        notAfter: certificate.validTo,
      },
    };
  }
}
