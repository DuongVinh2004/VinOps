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
  numSignatures?: number | undefined;
  hashes: string[];
  authMode?: 'push_notification' | 'otp' | 'pin' | undefined;
  clientData?: string | undefined;
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
  sad?: string | undefined; // Signature Activation Data (OTP / PIN)
  hashes: string[];
  signAlgo?: string | undefined;
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
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  isMock?: boolean | undefined;
};
