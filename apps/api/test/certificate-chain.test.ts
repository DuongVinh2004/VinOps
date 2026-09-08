import { generateKeyPairSync, type KeyObject, type X509Certificate } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTestX509Certificate,
  verifyCertificateChain,
} from '../src/pki/crypto/certificate-chain.js';

describe('X.509 Certificate Chain Verification (Leaf -> Intermediate -> Root CA)', () => {
  let rootCert: X509Certificate;
  let intermediateCert: X509Certificate;
  let leafCert: X509Certificate;

  let rootPrivateKey: KeyObject;
  let intermediatePrivateKey: KeyObject;

  beforeAll(() => {
    // 1. Root CA (Self-Signed)
    const rootKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    rootPrivateKey = rootKeys.privateKey;
    const rootRes = createTestX509Certificate({
      subjectCommonName: 'VinOps National Root CA',
      issuerCommonName: 'VinOps National Root CA',
      publicKey: rootKeys.publicKey,
      issuerPrivateKey: rootPrivateKey,
      serialNumber: 10001n,
      isCa: true,
    });
    rootCert = rootRes.certificate;

    // 2. Intermediate CA (Signed by Root CA)
    const intKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    intermediatePrivateKey = intKeys.privateKey;
    const intRes = createTestX509Certificate({
      subjectCommonName: 'VinOps Construction Issuing Sub-CA',
      issuerCommonName: 'VinOps National Root CA',
      publicKey: intKeys.publicKey,
      issuerPrivateKey: rootPrivateKey,
      serialNumber: 20002n,
      isCa: true,
    });
    intermediateCert = intRes.certificate;

    // 3. Leaf Signer Certificate (Signed by Intermediate CA)
    const leafKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const leafRes = createTestX509Certificate({
      subjectCommonName: 'Nguyen Van Tuan (Kỹ sư Nhà thầu)',
      issuerCommonName: 'VinOps Construction Issuing Sub-CA',
      publicKey: leafKeys.publicKey,
      issuerPrivateKey: intermediatePrivateKey,
      serialNumber: 30003n,
      isCa: false,
    });
    leafCert = leafRes.certificate;
  });

  it('verifies legitimate 3-tier certificate chain [leaf -> intermediate -> root] against trusted root', () => {
    const res = verifyCertificateChain([leafCert, intermediateCert, rootCert], [rootCert]);
    expect(res.isValid).toBe(true);
    expect(res.leaf).toBeDefined();
    expect(res.leaf?.subject).toContain('Nguyen Van Tuan');
    expect(res.chain).toHaveLength(3);
  });

  it('verifies 2-tier chain [leaf -> intermediate] anchored to external trusted root', () => {
    const res = verifyCertificateChain([leafCert, intermediateCert], [rootCert]);
    expect(res.isValid).toBe(true);
    expect(res.leaf?.subject).toContain('Nguyen Van Tuan');
  });

  it('rejects expired leaf certificate', () => {
    const expiredKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const expiredRes = createTestX509Certificate({
      subjectCommonName: 'Expired Signer',
      issuerCommonName: 'VinOps Construction Issuing Sub-CA',
      publicKey: expiredKeys.publicKey,
      issuerPrivateKey: intermediatePrivateKey,
      validFrom: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      validTo: new Date(Date.now() - 1 * 24 * 3600 * 1000), // expired yesterday
    });

    const res = verifyCertificateChain(
      [expiredRes.certificate, intermediateCert, rootCert],
      [rootCert],
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/expired/);
  });

  it('rejects not-yet-valid leaf certificate', () => {
    const futureKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const futureRes = createTestX509Certificate({
      subjectCommonName: 'Future Signer',
      issuerCommonName: 'VinOps Construction Issuing Sub-CA',
      publicKey: futureKeys.publicKey,
      issuerPrivateKey: intermediatePrivateKey,
      validFrom: new Date(Date.now() + 5 * 24 * 3600 * 1000), // valid 5 days in future
      validTo: new Date(Date.now() + 365 * 24 * 3600 * 1000),
    });

    const res = verifyCertificateChain(
      [futureRes.certificate, intermediateCert, rootCert],
      [rootCert],
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/not yet valid/);
  });

  it('rejects certificate chain when Root CA is untrusted (foreign root CA)', () => {
    // Generate an untrusted foreign root CA
    const rogueKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rogueRootRes = createTestX509Certificate({
      subjectCommonName: 'Rogue Untrusted CA',
      issuerCommonName: 'Rogue Untrusted CA',
      publicKey: rogueKeys.publicKey,
      issuerPrivateKey: rogueKeys.privateKey,
      isCa: true,
    });

    const rogueLeafKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rogueLeafRes = createTestX509Certificate({
      subjectCommonName: 'Attacker Signer',
      issuerCommonName: 'Rogue Untrusted CA',
      publicKey: rogueLeafKeys.publicKey,
      issuerPrivateKey: rogueKeys.privateKey,
    });

    const res = verifyCertificateChain(
      [rogueLeafRes.certificate, rogueRootRes.certificate],
      [rootCert],
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/not in trusted roots/);
  });

  it('rejects certificate chain when cryptographic signature link is broken', () => {
    // Generate a legitimate-looking cert that was signed by a different key than intermediate
    const impostorKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rogueSignerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

    const brokenLeafRes = createTestX509Certificate({
      subjectCommonName: 'Impostor Signer',
      issuerCommonName: 'VinOps Construction Issuing Sub-CA', // pretends to be issued by intermediate
      publicKey: impostorKeys.publicKey,
      issuerPrivateKey: rogueSignerKeys.privateKey, // BUT signed by rogue key!
    });

    const res = verifyCertificateChain(
      [brokenLeafRes.certificate, intermediateCert, rootCert],
      [rootCert],
    );
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/signature/i);
  });

  it('rejects empty chain or missing trusted roots', () => {
    const emptyChainRes = verifyCertificateChain([], [rootCert]);
    expect(emptyChainRes.isValid).toBe(false);
    expect(emptyChainRes.error).toMatch(/Empty certificate chain/);

    const emptyRootsRes = verifyCertificateChain([leafCert], []);
    expect(emptyRootsRes.isValid).toBe(false);
    expect(emptyRootsRes.error).toMatch(/No trusted root certificates/);
  });
});
