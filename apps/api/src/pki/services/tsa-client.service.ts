import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type KeyObject,
  type X509Certificate,
} from 'node:crypto';
import {
  ASN1_TAGS,
  derGeneralizedTime,
  derInteger,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  encodeLength,
  parseDer,
  parseGeneralizedTime,
  parseInteger,
  parseOid,
} from '../crypto/asn1-der.js';
import { createTestX509Certificate } from '../crypto/certificate-chain.js';
import {
  CMS_OIDS,
  createCmsSignedData,
  parseCmsSignedData,
  verifyCmsSignedData,
} from '../crypto/cms-signed-data.js';

export type TsaResult = {
  tokenBase64: string;
  timestamp: string; // ISO 8601
  serialNumber: string;
  tsaProvider: string;
  accuracy: string;
};

// DER OID for SHA-256: 2.16.840.1.101.3.4.2.1
const SHA256_OID_DER = Buffer.from([
  0x30,
  0x0d, // SEQUENCE 13 bytes
  0x06,
  0x09,
  0x60,
  0x86,
  0x48,
  0x01,
  0x65,
  0x03,
  0x04,
  0x02,
  0x01, // OID SHA-256
  0x05,
  0x00, // NULL
]);

export const TSA_POLICY_OID = '1.3.6.1.4.1.60000.1';

/**
 * Builds standard RFC 3161 ASN.1 DER TimeStampReq for a SHA-256 digest.
 */
export function buildTimeStampReq(hashHex: string, nonce?: bigint): Buffer {
  const hashBytes = Buffer.from(hashHex, 'hex');
  if (hashBytes.length !== 32) {
    throw new Error(`Expected 32-byte SHA-256 hash, received ${hashBytes.length} bytes`);
  }

  // MessageImprint: SEQUENCE { hashAlgorithm, hashedMessage }
  const messageImprintContent = Buffer.concat([
    SHA256_OID_DER,
    Buffer.from([0x04, hashBytes.length]), // OCTET STRING
    hashBytes,
  ]);
  const messageImprint = Buffer.concat([
    Buffer.from([0x30, messageImprintContent.length]),
    messageImprintContent,
  ]);

  // Version: INTEGER 1
  const version = Buffer.from([0x02, 0x01, 0x01]);

  // certReq: BOOLEAN TRUE (0x01 0x01 0xff)
  const certReq = Buffer.from([0x01, 0x01, 0xff]);

  // Nonce: 8 bytes integer
  const nonceValue = nonce ?? BigInt('0x' + randomBytes(8).toString('hex'));
  const nonceHex = nonceValue.toString(16);
  const noncePadded = nonceHex.length % 2 === 0 ? nonceHex : '0' + nonceHex;
  let nonceBytes = Buffer.from(noncePadded, 'hex');
  if ((nonceBytes[0]! & 0x80) !== 0) {
    nonceBytes = Buffer.concat([Buffer.from([0x00]), nonceBytes]);
  }
  const nonceDer = Buffer.concat([
    Buffer.from([0x02]),
    encodeLength(nonceBytes.length),
    nonceBytes,
  ]);

  return derSequence([version, messageImprint, nonceDer, certReq]);
}

/**
 * Parses TimeStampResp ASN.1 DER buffer according to RFC 3161 §2.4.2.
 */
export function parseTimeStampResp(
  responseBuffer: Buffer,
  options?: { expectedHashHex?: string; expectedNonce?: bigint | number },
): {
  status: number;
  tokenBytes: Buffer;
  timestamp: Date;
  serialNumber: string;
  policy: string;
} {
  if (responseBuffer.length < 10) {
    throw new Error('Invalid TimeStampResp: response buffer too short');
  }

  const root = parseDer(responseBuffer);
  if (root.tag !== ASN1_TAGS.SEQUENCE || !root.children || root.children.length === 0) {
    throw new Error('Invalid TimeStampResp: expected root SEQUENCE');
  }

  // 1. PKIStatusInfo
  const pkiStatusInfo = root.children[0]!;
  if (pkiStatusInfo.tag !== ASN1_TAGS.SEQUENCE || !pkiStatusInfo.children?.length) {
    throw new Error('Invalid TimeStampResp: expected PKIStatusInfo SEQUENCE');
  }

  const statusNode = pkiStatusInfo.children[0]!;
  if (statusNode.tag !== ASN1_TAGS.INTEGER) {
    throw new Error('Invalid TimeStampResp: expected PKIStatus INTEGER');
  }
  const status = Number(parseInteger(statusNode.value));

  if (status !== 0 && status !== 1) {
    throw new Error(`TSA server rejected request with PKIStatus: ${status}`);
  }

  if (root.children.length < 2) {
    throw new Error('Invalid TimeStampResp: missing timeStampToken');
  }

  // 2. TimeStampToken (CMS ContentInfo)
  const tokenNode = root.children[1]!;
  const tokenBytes = tokenNode.raw;

  const cms = parseCmsSignedData(tokenBytes);
  if (cms.encapContentTypeOid !== CMS_OIDS.ID_CT_TST_INFO) {
    throw new Error(
      `Invalid TimeStampToken: expected encapContentType ${CMS_OIDS.ID_CT_TST_INFO}, got ${cms.encapContentTypeOid}`,
    );
  }

  if (!cms.encapContentBytes || cms.encapContentBytes.length === 0) {
    throw new Error('Invalid TimeStampToken: missing TSTInfo encapContent');
  }

  // 3. TSTInfo
  const tstAst = parseDer(cms.encapContentBytes);
  if (tstAst.tag !== ASN1_TAGS.SEQUENCE || !tstAst.children || tstAst.children.length < 5) {
    throw new Error('Invalid TSTInfo: expected SEQUENCE with at least 5 elements');
  }

  let tIdx = 0;
  // version: INTEGER
  tIdx++;

  // policy: TSAPolicyId (OID)
  const policyNode = tstAst.children[tIdx++];
  const policy = policyNode ? parseOid(policyNode.value) : '';

  // messageImprint: SEQUENCE { hashAlgorithm, hashedMessage }
  const messageImprintNode = tstAst.children[tIdx++];
  if (
    !messageImprintNode ||
    !messageImprintNode.children ||
    messageImprintNode.children.length < 2
  ) {
    throw new Error('Invalid TSTInfo: malformed messageImprint');
  }

  const algNode = messageImprintNode.children[0]!;
  const hashAlgOid = algNode.children?.[0] ? parseOid(algNode.children[0].value) : '';
  if (hashAlgOid !== CMS_OIDS.SHA256) {
    throw new Error(
      `Invalid TSTInfo: expected SHA-256 algorithm OID (${CMS_OIDS.SHA256}), got ${hashAlgOid}`,
    );
  }

  const hashOctetNode = messageImprintNode.children[1]!;
  const hashedMessageHex = hashOctetNode.value.toString('hex').toLowerCase();

  if (options?.expectedHashHex && hashedMessageHex !== options.expectedHashHex.toLowerCase()) {
    throw new Error(
      `TSA messageImprint mismatch: expected ${options.expectedHashHex.toLowerCase()}, found ${hashedMessageHex}`,
    );
  }

  // serialNumber: INTEGER
  const serialNode = tstAst.children[tIdx++];
  if (!serialNode) {
    throw new Error('Invalid TSTInfo: missing serialNumber');
  }
  const serialNumber = parseInteger(serialNode.value).toString(16).toUpperCase();

  // genTime: GeneralizedTime
  const genTimeNode = tstAst.children[tIdx++];
  if (!genTimeNode) {
    throw new Error('Invalid TSTInfo: missing genTime');
  }
  const timestamp = parseGeneralizedTime(genTimeNode.value);

  // nonce (optional): next child with tag INTEGER
  let responseNonce: bigint | undefined;
  for (let i = tIdx; i < tstAst.children.length; i++) {
    const child = tstAst.children[i]!;
    if (child.tag === ASN1_TAGS.INTEGER) {
      responseNonce = parseInteger(child.value);
      break;
    }
  }

  if (options?.expectedNonce !== undefined) {
    const expNonce = BigInt(options.expectedNonce);
    if (responseNonce === undefined || responseNonce !== expNonce) {
      throw new Error(
        `TSA nonce mismatch: expected ${expNonce.toString()}, found ${responseNonce?.toString() ?? 'none'}`,
      );
    }
  }

  // 4. Verify TSA Signature on CMS SignedData
  const verifyResult = verifyCmsSignedData(cms);
  if (!verifyResult.isValid) {
    throw new Error(`TSA signature verification failed: ${verifyResult.error ?? 'Unknown error'}`);
  }

  return {
    status,
    tokenBytes,
    timestamp,
    serialNumber,
    policy,
  };
}

/**
 * Creates authentic RFC 3161 DER TimeStampResp buffer for mock/testing.
 */
export function createTimeStampResp(options: {
  hashHex: string;
  nonce?: bigint | number;
  genTime?: Date;
  serialNumber?: bigint;
  tsaCertificate: X509Certificate | Buffer;
  tsaPrivateKey: KeyObject | string;
  policyOid?: string;
}): Buffer {
  const hashBytes = Buffer.from(options.hashHex, 'hex');
  if (hashBytes.length !== 32) {
    throw new Error(`Expected 32-byte SHA-256 hash, received ${hashBytes.length}`);
  }

  const genDate = options.genTime ?? new Date();
  const serial = options.serialNumber ?? 1001n;
  const policy = options.policyOid ?? TSA_POLICY_OID;

  // 1. Build TSTInfo SEQUENCE
  const sha256Alg = derSequence([derOid(CMS_OIDS.SHA256), derNull()]);
  const messageImprint = derSequence([sha256Alg, derOctetString(hashBytes)]);

  const tstInfoParts: Buffer[] = [
    derInteger(1), // version 1
    derOid(policy),
    messageImprint,
    derInteger(serial),
    derGeneralizedTime(genDate),
  ];

  if (options.nonce !== undefined) {
    tstInfoParts.push(derInteger(BigInt(options.nonce)));
  }

  const tstInfoDer = derSequence(tstInfoParts);
  const tstInfoHash = createHash('sha256').update(tstInfoDer).digest('hex');

  // 2. Build TimeStampToken CMS SignedData
  const timeStampTokenDer = createCmsSignedData({
    documentHashHex: tstInfoHash,
    signerCertificate: options.tsaCertificate,
    signerPrivateKey: options.tsaPrivateKey,
    signingTime: genDate,
    eContentTypeOid: CMS_OIDS.ID_CT_TST_INFO,
    eContentBytes: tstInfoDer,
  });

  // 3. Build PKIStatusInfo: status 0 (granted)
  const pkiStatusInfo = derSequence([derInteger(0)]);

  // 4. TimeStampResp SEQUENCE { status, timeStampToken }
  return derSequence([pkiStatusInfo, timeStampTokenDer]);
}

export class TsaClientService {
  private mockTsaKeys: { privateKey: KeyObject; certificate: X509Certificate } | undefined;

  private getMockTsaKeys(): { privateKey: KeyObject; certificate: X509Certificate } {
    if (!this.mockTsaKeys) {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const { certificate } = createTestX509Certificate({
        subjectCommonName: 'VinOps National Time Stamping Authority',
        issuerCommonName: 'VinOps Root Timestamping CA',
        publicKey,
        issuerPrivateKey: privateKey,
        serialNumber: BigInt('0x' + randomUUID().replace(/-/g, '').slice(0, 16)),
      });
      this.mockTsaKeys = { privateKey, certificate };
    }
    return this.mockTsaKeys;
  }

  /**
   * Requests RFC 3161 timestamp token for given signature hash digest.
   */
  async requestTimestamp(
    hashHex: string,
    tsaUrl: string,
    credentials?: { authType: 'none' | 'basic' | 'bearer'; credentialsEncrypted?: string },
  ): Promise<TsaResult> {
    const isMock = tsaUrl.includes('mock') || !tsaUrl.startsWith('http');
    const nonce = BigInt('0x' + randomBytes(8).toString('hex'));

    if (isMock) {
      const { privateKey, certificate } = this.getMockTsaKeys();
      const respDer = createTimeStampResp({
        hashHex,
        nonce,
        tsaCertificate: certificate,
        tsaPrivateKey: privateKey,
      });

      const parsed = parseTimeStampResp(respDer, {
        expectedHashHex: hashHex,
        expectedNonce: nonce,
      });

      return {
        tokenBase64: parsed.tokenBytes.toString('base64'),
        timestamp: parsed.timestamp.toISOString(),
        serialNumber: parsed.serialNumber,
        tsaProvider: 'VinOps Legal TSA (RFC 3161)',
        accuracy: '10ms',
      };
    }

    const reqDer = buildTimeStampReq(hashHex, nonce);

    const headers: Record<string, string> = {
      'Content-Type': 'application/timestamp-query',
      Accept: 'application/timestamp-reply',
    };

    if (credentials?.authType === 'bearer' && credentials.credentialsEncrypted) {
      headers['Authorization'] = `Bearer ${credentials.credentialsEncrypted}`;
    } else if (credentials?.authType === 'basic' && credentials.credentialsEncrypted) {
      headers['Authorization'] = `Basic ${credentials.credentialsEncrypted}`;
    }

    const response = await fetch(tsaUrl, {
      method: 'POST',
      headers,
      body: reqDer,
    });

    if (!response.ok) {
      throw new Error(`TSA server returned HTTP ${response.status}: ${response.statusText}`);
    }

    const respBuffer = Buffer.from(await response.arrayBuffer());
    const parsed = parseTimeStampResp(respBuffer, {
      expectedHashHex: hashHex,
      expectedNonce: nonce,
    });

    if (parsed.status !== 0) {
      throw new Error(`TSA timestamping request rejected with PKIStatus ${parsed.status}`);
    }

    return {
      tokenBase64: parsed.tokenBytes.toString('base64'),
      timestamp: parsed.timestamp.toISOString(),
      serialNumber: parsed.serialNumber,
      tsaProvider: tsaUrl,
      accuracy: '10ms',
    };
  }
}
