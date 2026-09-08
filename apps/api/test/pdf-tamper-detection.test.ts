import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestX509Certificate } from '../src/pki/crypto/certificate-chain.js';
import { createCmsSignedData } from '../src/pki/crypto/cms-signed-data.js';
import {
  PdfPadesSignerService,
  type VisualSignatureOptions,
} from '../src/pki/services/pdf-pades-signer.service.js';
import { createTimeStampResp } from '../src/pki/services/tsa-client.service.js';

describe('PDF PAdES Tamper Detection & Cryptographic Integrity', () => {
  let signer: PdfPadesSignerService;
  let signedPdf: Buffer;

  const samplePdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n`,
    'utf8',
  );

  beforeAll(() => {
    signer = new PdfPadesSignerService();
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { certificate } = createTestX509Certificate({
      subjectCommonName: 'Kỹ sư Trưởng VinOps',
      issuerCommonName: 'VinOps CA Thẩm định',
      publicKey,
      issuerPrivateKey: privateKey,
    });

    const visualOptions: VisualSignatureOptions = {
      signerName: 'Kỹ sư Trưởng VinOps',
      signerTitle: 'tvgs_lead',
      organizationName: 'VinOps Supervision Group',
      signingTime: '2026-09-08T12:00:00.000Z',
      caIssuer: 'VinOps CA Thẩm định',
      certificateSerial: certificate.serialNumber,
      reason: 'Nghiệm thu chất lượng công trình',
    };

    const prepared = signer.preparePdfForSigning(samplePdf, visualOptions, 'B-LT');

    const cmsDer = createCmsSignedData({
      documentHashHex: prepared.documentHash,
      signerCertificate: certificate,
      signerPrivateKey: privateKey,
    });

    const tsaRespDer = createTimeStampResp({
      hashHex: prepared.documentHash,
      tsaCertificate: certificate,
      tsaPrivateKey: privateKey,
    });

    signedPdf = signer.embedSignature(
      prepared.preparedPdf,
      cmsDer.toString('base64'),
      tsaRespDer.toString('base64'),
    );
  });

  it('verifies untampered signed PDF successfully', () => {
    const res = signer.verifyPdfSignature(signedPdf);
    expect(res.isValid).toBe(true);
    expect(res.isIntegrityIntact).toBe(true);
    expect(res.documentModifiedSinceSigning).toBe(false);
    expect(res.signerName).toBe('Kỹ sư Trưởng VinOps');
    expect(res.padesLevel).toBe('B-LT');
    expect(res.tsaTimestamp).toBeDefined();
    expect(res.computedHash).toHaveLength(64);
  });

  it('detects 1-byte tamper in ByteRange Part A (before signature placeholder)', () => {
    const tampered = Buffer.from(signedPdf);
    // Alter a byte inside initial PDF content (Part A)
    tampered[15] = (tampered[15]! ^ 0xff) & 0xff;

    const res = signer.verifyPdfSignature(tampered);
    expect(res.isValid).toBe(false);
    expect(res.isIntegrityIntact).toBe(false);
  });

  it('detects 1-byte tamper in ByteRange Part B (after signature placeholder)', () => {
    const tampered = Buffer.from(signedPdf);
    // Alter a byte near the end of the PDF incremental update (Part B)
    tampered[tampered.length - 10] = (tampered[tampered.length - 10]! ^ 0xff) & 0xff;

    const res = signer.verifyPdfSignature(tampered);
    expect(res.isValid).toBe(false);
    expect(res.isIntegrityIntact).toBe(false);
  });

  it('detects modification outside ByteRange (appended content / trailer attack)', () => {
    // Append extra bytes to the end of the PDF (outside the declared ByteRange)
    const extraContent = Buffer.from('\n%% MALICIOUS_INJECTION_ATTACK_EXTRA_BYTES\n', 'utf8');
    const tampered = Buffer.concat([signedPdf, extraContent]);

    const res = signer.verifyPdfSignature(tampered);
    expect(res.isValid).toBe(false);
    expect(res.documentModifiedSinceSigning).toBe(true);
  });

  it('detects truncated PDF file', () => {
    // Truncate file so that offset2 + len2 is beyond the file length
    const truncated = signedPdf.subarray(0, signedPdf.length - 40);

    const res = signer.verifyPdfSignature(truncated);
    expect(res.isValid).toBe(false);
    expect(res.isIntegrityIntact).toBe(false);
  });

  it('detects corrupted CMS signature payload in /Contents', () => {
    const tampered = Buffer.from(signedPdf);
    const contentsIdx = tampered.indexOf(Buffer.from('/Contents <', 'utf8')) + 12;

    // Mutate a hex character of the embedded CMS signature
    tampered[contentsIdx] = tampered[contentsIdx] === 0x30 ? 0x31 : 0x30;

    const res = signer.verifyPdfSignature(tampered);
    expect(res.isValid).toBe(false);
    expect(res.isIntegrityIntact).toBe(false);
  });
});
