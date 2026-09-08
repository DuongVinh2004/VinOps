import { generateKeyPairSync, type KeyObject, type X509Certificate } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { derInteger, derSequence } from '../src/pki/crypto/asn1-der.js';
import { createTestX509Certificate } from '../src/pki/crypto/certificate-chain.js';
import {
  buildTimeStampReq,
  createTimeStampResp,
  parseTimeStampResp,
  TSA_POLICY_OID,
} from '../src/pki/services/tsa-client.service.js';

describe('RFC 3161 TimeStampResp ASN.1 DER Parser & Verifier', () => {
  let tsaCertificate: X509Certificate;
  let tsaPrivateKey: KeyObject;

  const validHash = '4a7d1ed414474e4033ac29ccb8653d9b12852eb3e4fb2d77d701aa80c47d337a';
  const wrongHash = '5b8e2fe525585f5144bd30ddc9764e0c23963fc4f50c3e88e812bb91d58e448b';
  const validNonce = 9876543210123456n;
  const wrongNonce = 1122334455667788n;

  beforeAll(() => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const { certificate } = createTestX509Certificate({
      subjectCommonName: 'VinOps National TSA Authority',
      issuerCommonName: 'VinOps Root Timestamping Authority',
      publicKey,
      issuerPrivateKey: privateKey,
    });
    tsaCertificate = certificate;
    tsaPrivateKey = privateKey;
  });

  it('parses authentic RFC 3161 DER TimeStampResp and extracts real genTime, serial, and policy', () => {
    const genTime = new Date('2026-09-08T10:30:00.000Z');
    const serial = 778899n;

    const respDer = createTimeStampResp({
      hashHex: validHash,
      nonce: validNonce,
      genTime,
      serialNumber: serial,
      tsaCertificate,
      tsaPrivateKey,
      policyOid: TSA_POLICY_OID,
    });

    const parsed = parseTimeStampResp(respDer, {
      expectedHashHex: validHash,
      expectedNonce: validNonce,
    });

    expect(parsed.status).toBe(0);
    expect(parsed.timestamp.toISOString()).toBe(genTime.toISOString());
    expect(parsed.serialNumber).toBe(serial.toString(16).toUpperCase());
    expect(parsed.policy).toBe(TSA_POLICY_OID);
    expect(parsed.tokenBytes.length).toBeGreaterThan(100);
  });

  it('rejects TimeStampResp when messageImprint does not match expected document hash', () => {
    const respDer = createTimeStampResp({
      hashHex: validHash,
      nonce: validNonce,
      tsaCertificate,
      tsaPrivateKey,
    });

    expect(() =>
      parseTimeStampResp(respDer, {
        expectedHashHex: wrongHash,
        expectedNonce: validNonce,
      }),
    ).toThrow(/TSA messageImprint mismatch/);
  });

  it('rejects TimeStampResp when nonce does not match expected request nonce', () => {
    const respDer = createTimeStampResp({
      hashHex: validHash,
      nonce: validNonce,
      tsaCertificate,
      tsaPrivateKey,
    });

    expect(() =>
      parseTimeStampResp(respDer, {
        expectedHashHex: validHash,
        expectedNonce: wrongNonce,
      }),
    ).toThrow(/TSA nonce mismatch/);
  });

  it('rejects TimeStampResp when TSA server returned error PKIStatus', () => {
    const badStatusPkiInfo = derSequence([derInteger(2)]); // status 2 = rejection
    const dummyToken = derSequence([derInteger(1)]);
    const badRespDer = derSequence([badStatusPkiInfo, dummyToken]);

    expect(() => parseTimeStampResp(badRespDer)).toThrow(
      /TSA server rejected request with PKIStatus: 2/,
    );
  });

  it('rejects TimeStampResp when TSA cryptographic signature is tampered', () => {
    const respDer = createTimeStampResp({
      hashHex: validHash,
      nonce: validNonce,
      tsaCertificate,
      tsaPrivateKey,
    });

    // Corrupt the signature value near the end of the buffer
    const tampered = Buffer.from(respDer);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20]! ^ 0xff) & 0xff;

    expect(() =>
      parseTimeStampResp(tampered, {
        expectedHashHex: validHash,
        expectedNonce: validNonce,
      }),
    ).toThrow(/TSA signature verification failed/);
  });

  it('builds valid RFC 3161 TimeStampReq ASN.1 DER buffer', () => {
    const reqDer = buildTimeStampReq(validHash, validNonce);
    expect(reqDer.length).toBeGreaterThan(30);
    // Begins with SEQUENCE (0x30)
    expect(reqDer[0]).toBe(0x30);
    // Contains the SHA-256 hash bytes
    expect(reqDer.includes(Buffer.from(validHash, 'hex'))).toBe(true);
  });
});
