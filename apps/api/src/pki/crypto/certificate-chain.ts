import { createPrivateKey, sign, X509Certificate, type KeyObject } from 'node:crypto';
import {
  derBitString,
  derBoolean,
  derInteger,
  derNull,
  derOctetString,
  derOid,
  derSequence,
  derSet,
  derTagged,
  derUtcTime,
  derUtf8String,
} from './asn1-der.js';

export type CertificateChainVerificationResult = {
  isValid: boolean;
  leaf?: X509Certificate;
  chain: X509Certificate[];
  error?: string;
};

/**
 * Verifies an X.509 certificate chain (leaf -> intermediate -> root).
 */
export function verifyCertificateChain(
  chainInput: Array<X509Certificate | Buffer | string>,
  trustedRootsInput: Array<X509Certificate | Buffer | string>,
  options?: { checkTime?: Date },
): CertificateChainVerificationResult {
  if (!chainInput || chainInput.length === 0) {
    return {
      isValid: false,
      chain: [],
      error: 'Empty certificate chain',
    };
  }

  const chain: X509Certificate[] = [];
  try {
    for (const item of chainInput) {
      chain.push(item instanceof X509Certificate ? item : new X509Certificate(item));
    }
  } catch (err) {
    return {
      isValid: false,
      chain,
      error: `Invalid certificate encoding in chain: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const trustedRoots: X509Certificate[] = [];
  try {
    for (const item of trustedRootsInput) {
      trustedRoots.push(item instanceof X509Certificate ? item : new X509Certificate(item));
    }
  } catch (err) {
    return {
      isValid: false,
      chain,
      error: `Invalid trusted root encoding: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (trustedRoots.length === 0) {
    return {
      isValid: false,
      chain,
      error: 'No trusted root certificates provided',
    };
  }

  const checkTime = options?.checkTime ?? new Date();

  // 1. Verify validity dates for each certificate in chain
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i]!;
    const from = new Date(cert.validFrom);
    const to = new Date(cert.validTo);

    if (checkTime < from) {
      return {
        isValid: false,
        chain,
        error: `Certificate at index ${i} is not yet valid (validFrom: ${cert.validFrom})`,
      };
    }
    if (checkTime > to) {
      return {
        isValid: false,
        chain,
        error: `Certificate at index ${i} is expired (validTo: ${cert.validTo})`,
      };
    }
  }

  // 2. Verify link signatures child -> parent
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]!;
    const parent = chain[i + 1]!;

    // Check Issuer == Subject
    if (!dnEquals(child.issuer, parent.subject)) {
      return {
        isValid: false,
        chain,
        error: `Certificate issuer mismatch at index ${i}: expected parent subject "${parent.subject}", got "${child.issuer}"`,
      };
    }

    // Verify cryptographic signature
    try {
      const isVerified = child.verify(parent.publicKey);
      if (!isVerified) {
        return {
          isValid: false,
          chain,
          error: `Cryptographic signature verification failed at index ${i} signed by index ${i + 1}`,
        };
      }
    } catch (err) {
      return {
        isValid: false,
        chain,
        error: `Signature check error at index ${i}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 3. Verify top of chain against trusted roots
  const topCert = chain[chain.length - 1]!;
  let isAnchorTrusted = false;

  for (const root of trustedRoots) {
    // Direct match with trusted root
    if (topCert.raw.equals(root.raw) || topCert.fingerprint256 === root.fingerprint256) {
      // If topCert is self-signed, verify its self-signature
      if (dnEquals(topCert.issuer, topCert.subject)) {
        if (!topCert.verify(topCert.publicKey)) {
          return {
            isValid: false,
            chain,
            error: 'Root CA self-signature verification failed',
          };
        }
      }
      isAnchorTrusted = true;
      break;
    }

    // Or topCert was issued directly by this trusted root
    if (dnEquals(topCert.issuer, root.subject)) {
      try {
        if (topCert.verify(root.publicKey)) {
          isAnchorTrusted = true;
          break;
        }
      } catch {
        // Continue checking other roots
      }
    }
  }

  if (!isAnchorTrusted) {
    return {
      isValid: false,
      chain,
      error: `Certificate chain anchor "${topCert.issuer}" is not in trusted roots`,
    };
  }

  return {
    isValid: true,
    leaf: chain[0]!,
    chain,
  };
}

function dnEquals(dn1: string, dn2: string): boolean {
  const norm = (s: string) =>
    s
      .split('\n')
      .join('/')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .sort()
      .join(';');
  return norm(dn1) === norm(dn2);
}

/**
 * Utility to create a real X.509 v3 certificate in DER format for testing and mock providers.
 */
export function createTestX509Certificate(options: {
  subjectCommonName: string;
  issuerCommonName: string;
  publicKey: KeyObject;
  issuerPrivateKey: KeyObject | string;
  serialNumber?: bigint;
  validFrom?: Date;
  validTo?: Date;
  isCa?: boolean;
}): { certDer: Buffer; certificate: X509Certificate } {
  const serial = options.serialNumber ?? 1n;
  const notBefore = options.validFrom ?? new Date(Date.now() - 24 * 3600 * 1000);
  const notAfter = options.validTo ?? new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const spkiDer = options.publicKey.export({ type: 'spki', format: 'der' });
  const sha256WithRsa = derSequence([derOid('1.2.840.113549.1.1.11'), derNull()]);
  const cnOid = derOid('2.5.4.3');

  const subjectName = derSequence([
    derSet([derSequence([cnOid, derUtf8String(options.subjectCommonName)])]),
  ]);
  const issuerName = derSequence([
    derSet([derSequence([cnOid, derUtf8String(options.issuerCommonName)])]),
  ]);

  const validity = derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]);

  // Extensions [3] EXPLICIT
  const extensionsList: Buffer[] = [];
  if (options.isCa) {
    // BasicConstraints: CA=TRUE
    const basicConstraintsOid = derOid('2.5.29.19');
    const basicConstraintsVal = derSequence([derBoolean(true)]);
    extensionsList.push(
      derSequence([basicConstraintsOid, derBoolean(true), derOctetString(basicConstraintsVal)]),
    );
  }

  const tbsChildren: Buffer[] = [
    derTagged(0, derInteger(2), true), // v3
    derInteger(serial),
    sha256WithRsa,
    issuerName,
    validity,
    subjectName,
    spkiDer,
  ];

  if (extensionsList.length > 0) {
    const extsSeq = derSequence(extensionsList);
    tbsChildren.push(derTagged(3, extsSeq, true));
  }

  const tbsDer = derSequence(tbsChildren);
  const signingKey =
    typeof options.issuerPrivateKey === 'string'
      ? createPrivateKey(options.issuerPrivateKey)
      : options.issuerPrivateKey;

  const signature = sign('sha256', tbsDer, signingKey);

  const certDer = derSequence([tbsDer, sha256WithRsa, derBitString(signature, 0)]);

  const certificate = new X509Certificate(certDer);
  return { certDer, certificate };
}
