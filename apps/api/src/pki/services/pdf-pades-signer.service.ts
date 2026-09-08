import { createHash } from 'node:crypto';
import type { PadesLevel } from '@vinops/domain';
import { parseDer, parseGeneralizedTime } from '../crypto/asn1-der.js';
import {
  injectTsaTokenIntoCms,
  parseCmsSignedData,
  verifyCmsSignedData,
} from '../crypto/cms-signed-data.js';

export type VisualSignatureOptions = {
  signerName: string;
  signerTitle: string;
  organizationName: string;
  signingTime: string; // ISO 8601 or formatted
  caIssuer: string;
  certificateSerial: string;
  reason?: string | undefined;
  pageNumber?: number | undefined;
  rect?: [number, number, number, number] | undefined;
};

export type SignPdfInput = {
  pdfBuffer: Buffer;
  signatureValueB64: string;
  padesLevel?: PadesLevel;
  tsaResponseB64?: string;
  ocspResponseB64?: string;
  visualOptions: VisualSignatureOptions;
};

export type SignatureVerificationResult = {
  isValid: boolean;
  isIntegrityIntact: boolean;
  documentModifiedSinceSigning: boolean;
  padesLevel: PadesLevel;
  signerName: string;
  certificateSerial: string;
  caIssuer?: string | undefined;
  signingTime?: string | undefined;
  tsaTimestamp?: string | undefined;
  hashAlgorithm: string;
  computedHash: string;
  certificate?:
    | {
        subject: string;
        issuer: string;
        serial: string;
        validFrom: string;
        validTo: string;
      }
    | undefined;
};

export const PLACEHOLDER_SIZE = 16384; // 16KB hex container for standard CMS SignedData

export class PdfPadesSignerService {
  /**
   * Prepares PDF for signing: creates signature placeholder and computes ByteRange hash.
   */
  preparePdfForSigning(
    pdfBuffer: Buffer,
    visualOptions: VisualSignatureOptions,
    padesLevel: PadesLevel = 'B-LT',
  ): {
    preparedPdf: Buffer;
    documentHash: string;
    byteRange: [number, number, number, number];
  } {
    const sigDate = new Date();
    const formattedDate = `D:${sigDate.getUTCFullYear()}${String(sigDate.getUTCMonth() + 1).padStart(2, '0')}${String(sigDate.getUTCDate()).padStart(2, '0')}${String(sigDate.getUTCHours()).padStart(2, '0')}${String(sigDate.getUTCMinutes()).padStart(2, '0')}${String(sigDate.getUTCSeconds()).padStart(2, '0')}Z`;

    const placeholderHex = '0'.repeat(PLACEHOLDER_SIZE);

    // Build incremental update containing signature dictionary & visual stamp
    const stampText = [
      `KY BOI: ${visualOptions.signerName}`,
      `CHUC DANH: ${visualOptions.signerTitle}`,
      `DON VI: ${visualOptions.organizationName}`,
      `NGAY KY: ${visualOptions.signingTime}`,
      `CA: ${visualOptions.caIssuer} [${visualOptions.certificateSerial.slice(0, 8)}...]`,
      `PADES: ${padesLevel}`,
    ].join('\n');

    const updatePart1 = `
% VinOps Legal PKI PAdES Incremental Update
999 0 obj
<<
  /Type /Sig
  /Filter /Adobe.PPKLite
  /SubFilter /ETSI.CAdES.detached
  /ByteRange [ 0000000000 0000000000 0000000000 0000000000 ]
  /Contents <${placeholderHex}>
  /M (${formattedDate})
  /Name (${this.escapePdfString(visualOptions.signerName)})
  /Reason (${this.escapePdfString(visualOptions.reason ?? 'Nghiem thu chat luong cong trinh TT 32/2026/TT-BXD')})
  /Location (Vietnam)
  /ContactInfo (${this.escapePdfString(visualOptions.organizationName)})
  /VinOpsStamp (${this.escapePdfString(stampText)})
>>
endobj
`;

    const combinedInitial = Buffer.concat([pdfBuffer, Buffer.from(updatePart1, 'utf8')]);

    // Locate Contents placeholder <00000...>
    const contentsTag = Buffer.from('/Contents <', 'utf8');
    const contentsIdx = combinedInitial.indexOf(contentsTag);
    if (contentsIdx === -1) {
      throw new Error('Failed to locate /Contents tag in prepared PDF');
    }

    const startHex = contentsIdx + contentsTag.length;
    const endHex = startHex + PLACEHOLDER_SIZE; // right before '>'

    const offset1 = 0;
    const len1 = startHex - 1; // includes '<'
    const offset2 = endHex + 1; // starts right after '>'
    const len2 = combinedInitial.length - offset2;

    const byteRangeString = `[ ${String(offset1).padStart(10, '0')} ${String(len1).padStart(10, '0')} ${String(offset2).padStart(10, '0')} ${String(len2).padStart(10, '0')} ]`;

    // Replace ByteRange placeholder
    const byteRangeTag = Buffer.from(
      '/ByteRange [ 0000000000 0000000000 0000000000 0000000000 ]',
      'utf8',
    );
    const byteRangeIdx = combinedInitial.indexOf(byteRangeTag);
    if (byteRangeIdx === -1) {
      throw new Error('Failed to locate /ByteRange placeholder');
    }

    const replacementByteRange = Buffer.from(`/ByteRange ${byteRangeString}`, 'utf8');
    replacementByteRange.copy(combinedInitial, byteRangeIdx);

    // Compute ByteRange hash
    const partA = combinedInitial.subarray(offset1, offset1 + len1);
    const partB = combinedInitial.subarray(offset2, offset2 + len2);

    const hash = createHash('sha256').update(partA).update(partB).digest('hex').toLowerCase();

    return {
      preparedPdf: combinedInitial,
      documentHash: hash,
      byteRange: [offset1, len1, offset2, len2],
    };
  }

  /**
   * Embeds CMS SignedData DER bytes (hex) into prepared PDF.
   */
  embedSignature(
    preparedPdf: Buffer,
    signatureValueB64: string,
    tsaTokenB64?: string,
    ocspResponseB64?: string,
  ): Buffer {
    void ocspResponseB64;
    const finalBuffer = Buffer.from(preparedPdf);

    let cmsDer = Buffer.from(signatureValueB64, 'base64');

    // If TSA token is provided and not already injected, inject into unsignedAttrs
    if (tsaTokenB64) {
      try {
        const rawTsa = Buffer.from(tsaTokenB64, 'base64');
        let tokenToInject = rawTsa;
        // If rawTsa is TimeStampResp, extract timeStampToken
        try {
          const tsaAst = parseDer(rawTsa);
          if (tsaAst.children && tsaAst.children.length >= 2) {
            tokenToInject = Buffer.from(tsaAst.children[1]!.raw);
          }
        } catch {
          // Keep rawTsa if already TimeStampToken
        }
        cmsDer = Buffer.from(injectTsaTokenIntoCms(cmsDer, tokenToInject));
      } catch {
        // Keep original cmsDer if injection fails
      }
    }

    const hexSignature = cmsDer.toString('hex').toLowerCase();
    if (hexSignature.length > PLACEHOLDER_SIZE) {
      throw new Error(
        `Signature payload (${hexSignature.length} hex chars) exceeds placeholder size (${PLACEHOLDER_SIZE})`,
      );
    }

    const paddedHex = hexSignature.padEnd(PLACEHOLDER_SIZE, '0');

    const contentsTag = Buffer.from('/Contents <', 'utf8');
    const contentsIdx = finalBuffer.indexOf(contentsTag);
    if (contentsIdx === -1) {
      throw new Error('Unable to find /Contents tag for signature embedding');
    }

    const hexStart = contentsIdx + contentsTag.length;
    Buffer.from(paddedHex, 'ascii').copy(finalBuffer, hexStart);

    return finalBuffer;
  }

  /**
   * Full one-step signing for convenience.
   */
  signPdf(input: SignPdfInput): {
    signedPdf: Buffer;
    documentHash: string;
  } {
    const level = input.padesLevel ?? 'B-LT';
    const { preparedPdf, documentHash } = this.preparePdfForSigning(
      input.pdfBuffer,
      input.visualOptions,
      level,
    );

    const signedPdf = this.embedSignature(
      preparedPdf,
      input.signatureValueB64,
      input.tsaResponseB64,
      input.ocspResponseB64,
    );

    return { signedPdf, documentHash };
  }

  /**
   * Cryptographic verification of signed PDF.
   * Validates ByteRange integrity and CMS SignedData DER against document hash.
   */
  verifyPdfSignature(pdfBuffer: Buffer): SignatureVerificationResult {
    const content = pdfBuffer.toString('utf8');
    const byteRangeMatch = content.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);

    if (!byteRangeMatch) {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning: true,
        padesLevel: 'B-B',
        signerName: 'Unknown',
        certificateSerial: 'Unknown',
        hashAlgorithm: 'SHA-256',
        computedHash: '',
      };
    }

    const offset1 = parseInt(byteRangeMatch[1]!, 10);
    const len1 = parseInt(byteRangeMatch[2]!, 10);
    const offset2 = parseInt(byteRangeMatch[3]!, 10);
    const len2 = parseInt(byteRangeMatch[4]!, 10);

    // Bounds & structure checks
    if (
      offset1 !== 0 ||
      len1 <= 0 ||
      offset2 <= offset1 + len1 ||
      offset2 + len2 > pdfBuffer.length
    ) {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning: true,
        padesLevel: 'B-B',
        signerName: 'Corrupted ByteRange',
        certificateSerial: '',
        hashAlgorithm: 'SHA-256',
        computedHash: '',
      };
    }

    const documentModifiedSinceSigning = offset2 + len2 !== pdfBuffer.length;

    const partA = pdfBuffer.subarray(offset1, offset1 + len1);
    const partB = pdfBuffer.subarray(offset2, offset2 + len2);

    const computedHash = createHash('sha256')
      .update(partA)
      .update(partB)
      .digest('hex')
      .toLowerCase();

    // Extract Contents hex between offset1 + len1 and offset2
    const gap = pdfBuffer.subarray(offset1 + len1, offset2).toString('ascii');
    const hexMatch = gap.match(/<([0-9a-fA-F]+)>/);
    if (!hexMatch) {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning,
        padesLevel: 'B-B',
        signerName: 'Missing Contents',
        certificateSerial: '',
        hashAlgorithm: 'SHA-256',
        computedHash,
      };
    }

    const hexString = hexMatch[1]!;
    const rawBytes = Buffer.from(hexString, 'hex');

    // Parse root ASN.1 DER to discard trailing '0' padding accurately
    let cmsDer: Buffer;
    try {
      const rootNode = parseDer(rawBytes);
      cmsDer = rawBytes.subarray(0, rootNode.totalLength);
    } catch {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning,
        padesLevel: 'B-B',
        signerName: 'Invalid DER',
        certificateSerial: '',
        hashAlgorithm: 'SHA-256',
        computedHash,
      };
    }

    // Parse and verify CMS SignedData
    let cms;
    try {
      cms = parseCmsSignedData(cmsDer);
    } catch {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning,
        padesLevel: 'B-B',
        signerName: 'Invalid CMS',
        certificateSerial: '',
        hashAlgorithm: 'SHA-256',
        computedHash,
      };
    }

    const cmsVerify = verifyCmsSignedData(cms, computedHash);

    // Extract TSA timestamp if present
    let tsaTimestamp: string | undefined;
    if (cmsVerify.hasTimeStampToken && cmsVerify.timeStampTokenDer) {
      try {
        const tokenAst = parseDer(cmsVerify.timeStampTokenDer);
        let tokenCmsDer = cmsVerify.timeStampTokenDer;
        // If wrapped in TimeStampResp SEQUENCE
        if (
          tokenAst.children &&
          tokenAst.children.length >= 2 &&
          tokenAst.children[0]?.children?.[0]?.tag === 0x02
        ) {
          tokenCmsDer = tokenAst.children[1]!.raw;
        }
        const tsaCms = parseCmsSignedData(tokenCmsDer);
        if (tsaCms.encapContentBytes) {
          const tstAst = parseDer(tsaCms.encapContentBytes);
          const genTimeNode = tstAst.children?.[4];
          if (genTimeNode) {
            tsaTimestamp = parseGeneralizedTime(genTimeNode.value).toISOString();
          }
        }
      } catch {
        // TSA parsing fallback
      }
    }

    // Extract metadata
    const cert = cmsVerify.signerCertificate;
    let signerName = 'Unknown';
    if (cert) {
      const cnMatch = cert.subject.match(/CN=([^,\n/]+)/);
      signerName = cnMatch ? cnMatch[1]!.trim() : cert.subject;
    }

    const padesLevel: PadesLevel = tsaTimestamp ? 'B-LT' : 'B-B';
    const isIntegrityIntact = !documentModifiedSinceSigning && cmsVerify.isValid;
    const isValid = isIntegrityIntact;

    return {
      isValid,
      isIntegrityIntact,
      documentModifiedSinceSigning,
      padesLevel,
      signerName,
      certificateSerial: cert ? cert.serialNumber : '',
      caIssuer: cert ? cert.issuer : undefined,
      signingTime:
        cmsVerify.signingTime && !isNaN(cmsVerify.signingTime.getTime())
          ? cmsVerify.signingTime.toISOString()
          : undefined,
      tsaTimestamp,
      hashAlgorithm: 'SHA-256',
      computedHash,
      certificate: cert
        ? {
            subject: cert.subject,
            issuer: cert.issuer,
            serial: cert.serialNumber,
            validFrom: cert.validFrom,
            validTo: cert.validTo,
          }
        : undefined,
    };
  }

  private escapePdfString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
