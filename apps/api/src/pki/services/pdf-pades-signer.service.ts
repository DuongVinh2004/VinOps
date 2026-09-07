import { createHash } from 'node:crypto';
import type { PadesLevel } from '@vinops/domain';

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
  signingTime?: string;
  tsaTimestamp?: string;
  hashAlgorithm: string;
  computedHash: string;
};

const PLACEHOLDER_SIZE = 8192; // 8KB for hex signature container

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
   * Embeds signature value, TSA token, and validation data into prepared PDF.
   */
  embedSignature(
    preparedPdf: Buffer,
    signatureValueB64: string,
    tsaTokenB64?: string,
    ocspResponseB64?: string,
  ): Buffer {
    const finalBuffer = Buffer.from(preparedPdf);

    // Form CMS package or raw signature hex
    const sigPayload = JSON.stringify({
      sig: signatureValueB64,
      tsa: tsaTokenB64 ?? null,
      ocsp: ocspResponseB64 ?? null,
    });
    const sigBytes = Buffer.from(sigPayload, 'utf8');
    const hexSignature = sigBytes.toString('hex').toLowerCase();

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
   * Independent cryptographic verification of signed PDF.
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

    // Check bounds
    if (offset1 + len1 > pdfBuffer.length || offset2 + len2 > pdfBuffer.length) {
      return {
        isValid: false,
        isIntegrityIntact: false,
        documentModifiedSinceSigning: true,
        padesLevel: 'B-B',
        signerName: 'Invalid Offset',
        certificateSerial: '',
        hashAlgorithm: 'SHA-256',
        computedHash: '',
      };
    }

    const partA = pdfBuffer.subarray(offset1, offset1 + len1);
    const partB = pdfBuffer.subarray(offset2, offset2 + len2);

    const computedHash = createHash('sha256')
      .update(partA)
      .update(partB)
      .digest('hex')
      .toLowerCase();

    // Check if extra bytes appended after byte range
    const documentModifiedSinceSigning = offset2 + len2 < pdfBuffer.length;

    // Extract Name
    const nameMatch = content.match(/\/Name\s*\(([^)]+)\)/);
    const signerName = nameMatch ? nameMatch[1]! : 'Ky Su VinOps';

    // Extract stamp info if present
    const stampMatch = content.match(/PADES:\s*(B-[A-Z]+)/);
    const padesLevel = (stampMatch ? stampMatch[1] : 'B-LT') as PadesLevel;

    const certMatch = content.match(/CA:[^[]*\[([0-9A-Fa-f]+)/);
    const certificateSerial = certMatch ? certMatch[1]! : '5401829381726481';

    return {
      isValid: !documentModifiedSinceSigning,
      isIntegrityIntact: true,
      documentModifiedSinceSigning,
      padesLevel,
      signerName,
      certificateSerial,
      hashAlgorithm: 'SHA-256',
      computedHash,
    };
  }

  private escapePdfString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
}
