import { createPrivateKey, sign, verify, X509Certificate, type KeyObject } from 'node:crypto';
import {
  ASN1_TAGS,
  derInteger,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  derSet,
  derTagged,
  derUtcTime,
  encodeLength,
  parseDer,
  parseGeneralizedTime,
  parseInteger,
  parseOid,
  parseUtcTime,
  type Asn1Node,
} from './asn1-der.js';

export const CMS_OIDS = {
  ID_DATA: '1.2.840.113549.1.7.1',
  ID_SIGNED_DATA: '1.2.840.113549.1.7.2',
  CONTENT_TYPE: '1.2.840.113549.1.9.3',
  MESSAGE_DIGEST: '1.2.840.113549.1.9.4',
  SIGNING_TIME: '1.2.840.113549.1.9.5',
  TIMESTAMP_TOKEN: '1.2.840.113549.1.9.16.2.14',
  ID_CT_TST_INFO: '1.2.840.113549.1.9.16.1.4',
  SHA256: '2.16.840.1.101.3.4.2.1',
  RSA_ENCRYPTION: '1.2.840.113549.1.1.1',
  SHA256_WITH_RSA: '1.2.840.113549.1.1.11',
  ECDSA_WITH_SHA256: '1.2.840.10045.4.3.2',
} as const;

export type ParsedSignedAttrs = {
  rawDerForVerify: Buffer; // DER encoded SET OF with 0x31 tag
  contentType?: string | undefined;
  messageDigest?: string | undefined; // hex lowercase
  signingTime?: Date | undefined;
};

export type ParsedSignerInfo = {
  version: number;
  digestAlgorithmOid: string;
  signedAttrs?: ParsedSignedAttrs | undefined;
  signatureAlgorithmOid: string;
  signatureValue: Buffer;
  unsignedAttrs?:
    | {
        timeStampTokenDer?: Buffer | undefined;
      }
    | undefined;
};

export type ParsedCmsSignedData = {
  rawDer: Buffer;
  contentTypeOid: string;
  version: number;
  digestAlgorithmOids: string[];
  encapContentTypeOid: string;
  encapContentBytes?: Buffer | undefined;
  certificates: X509Certificate[];
  signerInfos: ParsedSignerInfo[];
};

/**
 * Parses CMS ContentInfo DER containing SignedData (RFC 5652).
 */
export function parseCmsSignedData(derBuffer: Buffer): ParsedCmsSignedData {
  if (derBuffer.length < 10) {
    throw new Error('CMS parse error: buffer too short');
  }

  const root = parseDer(derBuffer);
  if (root.tag !== ASN1_TAGS.SEQUENCE || !root.children || root.children.length < 2) {
    throw new Error('CMS parse error: expected ContentInfo SEQUENCE with at least 2 elements');
  }

  const contentTypeNode = root.children[0]!;
  if (contentTypeNode.tag !== ASN1_TAGS.OID) {
    throw new Error('CMS parse error: first element must be ContentType OID');
  }
  const contentTypeOid = parseOid(contentTypeNode.value);
  if (contentTypeOid !== CMS_OIDS.ID_SIGNED_DATA) {
    throw new Error(
      `CMS parse error: expected contentType ${CMS_OIDS.ID_SIGNED_DATA} (signedData), received ${contentTypeOid}`,
    );
  }

  const contentExplicitNode = root.children[1]!;
  if ((contentExplicitNode.tag & 0x1f) !== 0 || !contentExplicitNode.children?.length) {
    throw new Error('CMS parse error: content must be [0] EXPLICIT');
  }

  const signedDataNode = contentExplicitNode.children[0]!;
  if (signedDataNode.tag !== ASN1_TAGS.SEQUENCE || !signedDataNode.children) {
    throw new Error('CMS parse error: SignedData must be a SEQUENCE');
  }

  let idx = 0;
  // 1. Version
  const versionNode = signedDataNode.children[idx++];
  if (!versionNode || versionNode.tag !== ASN1_TAGS.INTEGER) {
    throw new Error('CMS parse error: expected version INTEGER in SignedData');
  }
  const version = Number(parseInteger(versionNode.value));

  // 2. DigestAlgorithms
  const digestAlgsNode = signedDataNode.children[idx++];
  if (!digestAlgsNode || digestAlgsNode.tag !== ASN1_TAGS.SET || !digestAlgsNode.children) {
    throw new Error('CMS parse error: expected digestAlgorithms SET');
  }
  const digestAlgorithmOids = digestAlgsNode.children.map((algSeq) => {
    const oidNode = algSeq.children?.[0];
    return oidNode ? parseOid(oidNode.value) : '';
  });

  // 3. EncapContentInfo
  const encapNode = signedDataNode.children[idx++];
  if (!encapNode || encapNode.tag !== ASN1_TAGS.SEQUENCE || !encapNode.children?.length) {
    throw new Error('CMS parse error: expected encapContentInfo SEQUENCE');
  }
  const encapContentTypeOid = parseOid(encapNode.children[0]!.value);
  let encapContentBytes: Buffer | undefined;
  if (encapNode.children.length > 1) {
    const eContentNode = encapNode.children[1]!;
    if (eContentNode.children && eContentNode.children.length > 0) {
      encapContentBytes = eContentNode.children[0]!.value;
    } else {
      encapContentBytes = eContentNode.value;
    }
  }

  // 4. Certificates (optional, [0] IMPLICIT)
  const certificates: X509Certificate[] = [];
  let nextNode = signedDataNode.children[idx];
  if (nextNode && (nextNode.tag & 0x1f) === 0 && (nextNode.tag & 0x80) !== 0) {
    // [0] Certificates
    if (nextNode.children) {
      for (const certNode of nextNode.children) {
        try {
          certificates.push(new X509Certificate(certNode.raw));
        } catch {
          // Ignore unparseable certificate
        }
      }
    }
    idx++;
    nextNode = signedDataNode.children[idx];
  }

  // 5. CRLs (optional, [1] IMPLICIT)
  if (nextNode && (nextNode.tag & 0x1f) === 1 && (nextNode.tag & 0x80) !== 0) {
    idx++;
  }

  // 6. SignerInfos
  const signerInfosNode = signedDataNode.children[idx];
  if (!signerInfosNode || signerInfosNode.tag !== ASN1_TAGS.SET || !signerInfosNode.children) {
    throw new Error('CMS parse error: expected signerInfos SET');
  }

  const signerInfos: ParsedSignerInfo[] = [];
  for (const sInfoSeq of signerInfosNode.children) {
    if (sInfoSeq.tag !== ASN1_TAGS.SEQUENCE || !sInfoSeq.children) continue;
    let sIdx = 0;
    const sVersion = Number(parseInteger(sInfoSeq.children[sIdx++]!.value));
    sIdx++; // skip sid (issuerAndSerialNumber or subjectKeyIdentifier)

    const sDigestAlgNode = sInfoSeq.children[sIdx++];
    const sDigestAlgOid = sDigestAlgNode?.children?.[0]
      ? parseOid(sDigestAlgNode.children[0].value)
      : '';

    // signedAttrs [0] IMPLICIT
    let signedAttrs: ParsedSignedAttrs | undefined;
    let currSNode = sInfoSeq.children[sIdx];
    if (currSNode && (currSNode.tag & 0x1f) === 0 && (currSNode.tag & 0x80) !== 0) {
      // Convert implicit tag [0] to SET OF tag 0x31 for signature verification (RFC 5652 §5.4)
      const content = currSNode.value;
      const rawDerForVerify = Buffer.concat([
        Buffer.from([ASN1_TAGS.SET]),
        encodeLength(content.length),
        content,
      ]);

      let parsedAttrsContentType: string | undefined;
      let parsedAttrsMessageDigest: string | undefined;
      let parsedAttrsSigningTime: Date | undefined;

      if (currSNode.children) {
        for (const attrSeq of currSNode.children) {
          if (!attrSeq.children || attrSeq.children.length < 2) continue;
          const attrOid = parseOid(attrSeq.children[0]!.value);
          const attrValuesSet = attrSeq.children[1]!;
          const firstVal = attrValuesSet.children?.[0];
          if (!firstVal) continue;

          if (attrOid === CMS_OIDS.CONTENT_TYPE) {
            parsedAttrsContentType = parseOid(firstVal.value);
          } else if (attrOid === CMS_OIDS.MESSAGE_DIGEST) {
            parsedAttrsMessageDigest = firstVal.value.toString('hex').toLowerCase();
          } else if (attrOid === CMS_OIDS.SIGNING_TIME) {
            try {
              if (firstVal.tag === ASN1_TAGS.UTC_TIME) {
                parsedAttrsSigningTime = parseUtcTime(firstVal.value);
              } else if (firstVal.tag === ASN1_TAGS.GENERALIZED_TIME) {
                parsedAttrsSigningTime = parseGeneralizedTime(firstVal.value);
              }
            } catch {
              // Ignore malformed signing time
            }
          }
        }
      }

      signedAttrs = {
        rawDerForVerify,
        contentType: parsedAttrsContentType,
        messageDigest: parsedAttrsMessageDigest,
        signingTime: parsedAttrsSigningTime,
      };
      sIdx++;
    }

    const sSigAlgNode = sInfoSeq.children[sIdx++];
    const sSigAlgOid = sSigAlgNode?.children?.[0] ? parseOid(sSigAlgNode.children[0].value) : '';

    const sigValNode = sInfoSeq.children[sIdx++];
    const signatureValue = sigValNode ? sigValNode.value : Buffer.alloc(0);

    // unsignedAttrs [1] IMPLICIT
    let unsignedAttrs: { timeStampTokenDer?: Buffer } | undefined;
    currSNode = sInfoSeq.children[sIdx];
    if (currSNode && (currSNode.tag & 0x1f) === 1 && (currSNode.tag & 0x80) !== 0) {
      if (currSNode.children) {
        for (const uAttrSeq of currSNode.children) {
          if (!uAttrSeq.children || uAttrSeq.children.length < 2) continue;
          const uAttrOid = parseOid(uAttrSeq.children[0]!.value);
          if (uAttrOid === CMS_OIDS.TIMESTAMP_TOKEN) {
            const uAttrValuesSet = uAttrSeq.children[1]!;
            const tokenNode = uAttrValuesSet.children?.[0];
            if (tokenNode) {
              unsignedAttrs = {
                timeStampTokenDer: tokenNode.raw,
              };
            }
          }
        }
      }
    }

    signerInfos.push({
      version: sVersion,
      digestAlgorithmOid: sDigestAlgOid,
      signedAttrs,
      signatureAlgorithmOid: sSigAlgOid,
      signatureValue,
      unsignedAttrs,
    });
  }

  return {
    rawDer: derBuffer,
    contentTypeOid,
    version,
    digestAlgorithmOids,
    encapContentTypeOid,
    encapContentBytes,
    certificates,
    signerInfos,
  };
}

/**
 * Verifies CMS SignedData cryptographic signature against document hash.
 */
export function verifyCmsSignedData(
  cms: ParsedCmsSignedData,
  expectedDocumentHashHex?: string,
): {
  isValid: boolean;
  signerCertificate: X509Certificate | undefined;
  signingTime?: Date | undefined;
  messageDigestHex?: string | undefined;
  hasTimeStampToken: boolean;
  timeStampTokenDer?: Buffer | undefined;
  error?: string | undefined;
} {
  if (cms.signerInfos.length === 0) {
    return {
      isValid: false,
      signerCertificate: undefined,
      hasTimeStampToken: false,
      error: 'No signerInfos in CMS SignedData',
    };
  }

  const sInfo = cms.signerInfos[0]!;
  const cert = cms.certificates[0];
  if (!cert) {
    return {
      isValid: false,
      signerCertificate: undefined,
      hasTimeStampToken: false,
      error: 'No signer certificate attached in CMS SignedData',
    };
  }

  const hasTimeStampToken = !!sInfo.unsignedAttrs?.timeStampTokenDer;
  const timeStampTokenDer = sInfo.unsignedAttrs?.timeStampTokenDer;

  // 1. Verify messageDigest in signedAttrs
  if (sInfo.signedAttrs) {
    const msgDigest = sInfo.signedAttrs.messageDigest;
    if (!msgDigest) {
      return {
        isValid: false,
        signerCertificate: cert,
        hasTimeStampToken,
        timeStampTokenDer,
        error: 'Missing messageDigest in signedAttrs',
      };
    }

    if (
      expectedDocumentHashHex &&
      msgDigest.toLowerCase() !== expectedDocumentHashHex.toLowerCase()
    ) {
      return {
        isValid: false,
        signerCertificate: cert,
        signingTime: sInfo.signedAttrs.signingTime,
        messageDigestHex: msgDigest,
        hasTimeStampToken,
        timeStampTokenDer,
        error: `Message digest mismatch: expected ${expectedDocumentHashHex}, found ${msgDigest}`,
      };
    }

    // 2. Verify signature on signedAttrs SET OF DER
    try {
      const publicKey = cert.publicKey;
      const isSigValid = verify(
        'sha256',
        sInfo.signedAttrs.rawDerForVerify,
        publicKey,
        sInfo.signatureValue,
      );

      return {
        isValid: isSigValid,
        signerCertificate: cert,
        signingTime: sInfo.signedAttrs.signingTime,
        messageDigestHex: msgDigest,
        hasTimeStampToken,
        timeStampTokenDer,
        ...(isSigValid ? {} : { error: 'Cryptographic signature verification failed' }),
      };
    } catch (err) {
      return {
        isValid: false,
        signerCertificate: cert,
        signingTime: sInfo.signedAttrs.signingTime,
        messageDigestHex: msgDigest,
        hasTimeStampToken,
        timeStampTokenDer,
        error: `Signature verification exception: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Direct signature without signedAttrs
  try {
    const publicKey = cert.publicKey;
    const dataToVerify = expectedDocumentHashHex
      ? Buffer.from(expectedDocumentHashHex, 'hex')
      : Buffer.alloc(0);
    const isSigValid = verify('sha256', dataToVerify, publicKey, sInfo.signatureValue);
    return {
      isValid: isSigValid,
      signerCertificate: cert,
      hasTimeStampToken,
      timeStampTokenDer,
      ...(isSigValid ? {} : { error: 'Direct signature verification failed' }),
    };
  } catch (err) {
    return {
      isValid: false,
      signerCertificate: cert,
      hasTimeStampToken,
      timeStampTokenDer,
      error: `Direct verification exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Creates standard RFC 5652 CMS SignedData DER package.
 */
export function createCmsSignedData(options: {
  documentHashHex: string;
  signerCertificate: X509Certificate | Buffer;
  signerPrivateKey: KeyObject | string;
  signingTime?: Date;
  tsaTokenDer?: Buffer;
  eContentTypeOid?: string;
  eContentBytes?: Buffer;
}): Buffer {
  const hashBytes = Buffer.from(options.documentHashHex, 'hex');
  if (hashBytes.length !== 32) {
    throw new Error(`Expected 32-byte SHA-256 hash, received ${hashBytes.length}`);
  }

  const certDer =
    options.signerCertificate instanceof X509Certificate
      ? options.signerCertificate.raw
      : options.signerCertificate;

  const parsedCert = new X509Certificate(certDer);
  const signingDate = options.signingTime ?? new Date();
  const eContentType = options.eContentTypeOid ?? CMS_OIDS.ID_DATA;

  // 1. Build signedAttributes:
  // - contentType: eContentType
  const attrContentType = derSequence([
    derOid(CMS_OIDS.CONTENT_TYPE),
    derSet([derOid(eContentType)]),
  ]);

  // - messageDigest: documentHash
  const attrMessageDigest = derSequence([
    derOid(CMS_OIDS.MESSAGE_DIGEST),
    derSet([derOctetString(hashBytes)]),
  ]);

  // - signingTime: UTCTime
  const attrSigningTime = derSequence([
    derOid(CMS_OIDS.SIGNING_TIME),
    derSet([derUtcTime(signingDate)]),
  ]);

  // SET OF SignedAttributes (sorted lexicographically for DER)
  const signedAttrsSet = derSet([attrContentType, attrMessageDigest, attrSigningTime], true);

  // Sign signedAttrsSet with private key
  const privateKey =
    typeof options.signerPrivateKey === 'string'
      ? createPrivateKey(options.signerPrivateKey)
      : options.signerPrivateKey;

  const signatureBytes = sign('sha256', signedAttrsSet, privateKey);

  // Tag signedAttrs as [0] IMPLICIT: replace tag 0x31 with 0xA0
  const signedAttrsImplicit = Buffer.concat([Buffer.from([0xa0]), signedAttrsSet.subarray(1)]);

  // 2. UnsignedAttributes (optional, e.g. TSA TimeStampToken)
  let unsignedAttrsImplicit: Buffer | undefined;
  if (options.tsaTokenDer) {
    const attrTsa = derSequence([derOid(CMS_OIDS.TIMESTAMP_TOKEN), derSet([options.tsaTokenDer])]);
    const unsignedAttrsSet = derSet([attrTsa], true);
    unsignedAttrsImplicit = Buffer.concat([Buffer.from([0xa1]), unsignedAttrsSet.subarray(1)]);
  }

  // 3. SignerIdentifier (IssuerAndSerialNumber)
  // Extract issuer DER and serial from certificate DER
  const certAst = parseDer(certDer);
  const tbsCert = certAst.children?.[0]; // TBSCertificate
  let issuerNode: Asn1Node | undefined;
  let serialNode: Asn1Node | undefined;

  if (tbsCert?.children) {
    // Index 0 may be version [0] EXPLICIT
    let tIdx = 0;
    if ((tbsCert.children[0]!.tag & 0x1f) === 0) {
      tIdx++;
    }
    serialNode = tbsCert.children[tIdx++];
    tIdx++; // signature AlgorithmIdentifier
    issuerNode = tbsCert.children[tIdx];
  }

  const sid = derSequence([
    issuerNode ? issuerNode.raw : derSequence([]),
    serialNode ? serialNode.raw : derInteger(BigInt(`0x${parsedCert.serialNumber}`)),
  ]);

  // AlgorithmIdentifiers
  const sha256Alg = derSequence([derOid(CMS_OIDS.SHA256), derNull()]);
  const rsaSigAlg = derSequence([derOid(CMS_OIDS.SHA256_WITH_RSA), derNull()]);

  // 4. SignerInfo SEQUENCE
  const signerInfoParts: Buffer[] = [
    derInteger(1), // version 1
    sid,
    sha256Alg,
    signedAttrsImplicit,
    rsaSigAlg,
    derOctetString(signatureBytes),
  ];
  if (unsignedAttrsImplicit) {
    signerInfoParts.push(unsignedAttrsImplicit);
  }
  const signerInfo = derSequence(signerInfoParts);

  // 5. SignedData SEQUENCE
  const encapContentInfo = options.eContentBytes
    ? derSequence([derOid(eContentType), derTagged(0, derOctetString(options.eContentBytes), true)])
    : derSequence([derOid(eContentType)]);
  const certsTag = Buffer.concat([Buffer.from([0xa0]), encodeLength(certDer.length), certDer]);
  const signerInfos = derSet([signerInfo]);

  const signedData = derSequence([
    derInteger(1), // version 1
    derSet([sha256Alg]),
    encapContentInfo,
    certsTag,
    signerInfos,
  ]);

  // 6. ContentInfo SEQUENCE
  return derSequence([derOid(CMS_OIDS.ID_SIGNED_DATA), derTagged(0, signedData, true)]);
}

/**
 * Injects a TSA TimeStampToken into an existing CMS SignedData as unsignedAttr.
 */
export function injectTsaTokenIntoCms(cmsDer: Buffer, tsaTokenDer: Buffer): Buffer {
  const parsed = parseCmsSignedData(cmsDer);
  if (parsed.signerInfos.length === 0) {
    throw new Error('Cannot inject TSA token: no signerInfos found');
  }

  // Re-encode or reconstruct with unsignedAttrs
  const cert = parsed.certificates[0];
  if (!cert) {
    throw new Error('Cannot inject TSA token: certificate not found');
  }

  // Root ContentInfo
  const root = parseDer(cmsDer);
  const signedDataSeq = root.children![1]!.children![0]!;
  const signerInfosSet = signedDataSeq.children![signedDataSeq.children!.length - 1]!;
  const signerInfoSeq = signerInfosSet.children![0]!;

  // Check if unsignedAttrs already present
  const attrTsa = derSequence([derOid(CMS_OIDS.TIMESTAMP_TOKEN), derSet([tsaTokenDer])]);
  const newUnsignedAttrsSet = derSet([attrTsa], true);
  const newUnsignedAttrsImplicit = Buffer.concat([
    Buffer.from([0xa1]),
    newUnsignedAttrsSet.subarray(1),
  ]);

  const existingParts: Buffer[] = [];
  for (const child of signerInfoSeq.children!) {
    // Check if tag is [1] unsignedAttrs
    if ((child.tag & 0x1f) === 1 && (child.tag & 0x80) !== 0) {
      // replace
      continue;
    }
    existingParts.push(child.raw);
  }
  existingParts.push(newUnsignedAttrsImplicit);

  const updatedSignerInfo = derSequence(existingParts);
  const updatedSignerInfosSet = derSet([updatedSignerInfo]);

  // Rebuild SignedData
  const signedDataChildren: Buffer[] = [];
  for (let i = 0; i < signedDataSeq.children!.length - 1; i++) {
    signedDataChildren.push(signedDataSeq.children![i]!.raw);
  }
  signedDataChildren.push(updatedSignerInfosSet);

  const updatedSignedData = derSequence(signedDataChildren);
  return derSequence([derOid(CMS_OIDS.ID_SIGNED_DATA), derTagged(0, updatedSignedData, true)]);
}
