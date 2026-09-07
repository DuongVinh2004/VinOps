import { createHash } from 'node:crypto';
import { DomainError } from '../errors.js';

export const signatureSessionStatuses = [
  'pending',
  'otp_sent',
  'signed',
  'rejected',
  'expired',
  'skipped',
] as const;
export type SignatureSessionStatus = (typeof signatureSessionStatuses)[number];

export const signerRoles = ['contractor_rep', 'tvgs_lead', 'pmu_manager'] as const;
export type SignerRole = (typeof signerRoles)[number];

export const signingActions = ['authorize', 'sign', 'reject', 'expire', 'skip'] as const;
export type SigningAction = (typeof signingActions)[number];

export const signableTypes = [
  'acceptance_record',
  'daily_log',
  'as_built_dossier',
  'document_transmittal',
] as const;
export type SignableType = (typeof signableTypes)[number];

export const padesLevels = ['B-B', 'B-T', 'B-LT', 'B-LTA'] as const;
export type PadesLevel = (typeof padesLevels)[number];

export const signingProviderCodes = ['vnpt_smartca', 'viettel_cloud_ca', 'trust_ca'] as const;
export type SigningProviderCode = (typeof signingProviderCodes)[number];

export const ORDER_TO_ROLE: Record<number, SignerRole> = {
  1: 'contractor_rep',
  2: 'tvgs_lead',
  3: 'pmu_manager',
};

export const ROLE_TO_ORDER: Record<SignerRole, number> = {
  contractor_rep: 1,
  tvgs_lead: 2,
  pmu_manager: 3,
};

/**
 * Validates whether a state transition is legal in the signing workflow.
 */
export function nextState(
  currentState: SignatureSessionStatus,
  action: SigningAction,
): SignatureSessionStatus {
  switch (currentState) {
    case 'pending':
      if (action === 'authorize') return 'otp_sent';
      if (action === 'reject') return 'rejected';
      if (action === 'expire') return 'expired';
      if (action === 'skip') return 'skipped';
      break;
    case 'otp_sent':
      if (action === 'sign') return 'signed';
      if (action === 'authorize') return 'otp_sent'; // Re-send OTP
      if (action === 'reject') return 'rejected';
      if (action === 'expire') return 'expired';
      break;
    case 'signed':
    case 'rejected':
    case 'expired':
    case 'skipped':
      // Terminal states cannot transition
      break;
  }

  throw new DomainError(
    'INVALID_SIGNING_STATE_TRANSITION',
    `Cannot perform action "${action}" from state "${currentState}".`,
  );
}

/**
 * Checks whether a specific signer role and order can sign the document.
 * Requires:
 * 1. Current session state is 'pending' or 'otp_sent'.
 * 2. Signer role matches required role for signing order.
 * 3. If signing order > 1, previous level MUST be 'signed'.
 * 4. Current timestamp must be before expiry.
 */
export function canSign(
  currentState: SignatureSessionStatus,
  signerRole: SignerRole,
  signingOrder: number,
  previousSessionState?: SignatureSessionStatus,
  expiresAt?: Date | string,
  now: Date = new Date(),
): boolean {
  if (currentState !== 'pending' && currentState !== 'otp_sent') {
    return false;
  }

  const expectedRole = ORDER_TO_ROLE[signingOrder];
  if (expectedRole !== signerRole) {
    return false;
  }

  if (signingOrder > 1 && previousSessionState !== 'signed') {
    return false;
  }

  if (expiresAt !== undefined) {
    const expDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    if (now.getTime() >= expDate.getTime()) {
      return false;
    }
  }

  return true;
}

/**
 * Asserts that a user can sign; throws DomainError on violation.
 */
export function assertCanSign(
  currentState: SignatureSessionStatus,
  signerRole: SignerRole,
  signingOrder: number,
  previousSessionState?: SignatureSessionStatus,
  expiresAt?: Date | string,
  now: Date = new Date(),
): void {
  if (expiresAt !== undefined) {
    const expDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    if (now.getTime() >= expDate.getTime()) {
      throw new DomainError('SIGNING_SESSION_EXPIRED', 'The signing session has expired.');
    }
  }

  if (currentState !== 'pending' && currentState !== 'otp_sent') {
    throw new DomainError(
      'INVALID_SESSION_STATUS_FOR_SIGNING',
      `Session status "${currentState}" does not permit signing.`,
    );
  }

  const expectedRole = ORDER_TO_ROLE[signingOrder];
  if (expectedRole !== signerRole) {
    throw new DomainError(
      'SIGNER_ROLE_MISMATCH',
      `Role "${signerRole}" is not authorized for signing step ${signingOrder} (expected "${expectedRole}").`,
    );
  }

  if (signingOrder > 1 && previousSessionState !== 'signed') {
    throw new DomainError(
      'SEQUENTIAL_ORDER_VIOLATION',
      `Step ${signingOrder} requires step ${signingOrder - 1} to be completed before signing.`,
    );
  }
}

export type DossierChainItem = {
  itemId: string;
  itemHash: string;
  sequence: number;
  itemType: string;
};

export type HashChainNode = {
  index: number;
  itemType: string;
  itemId?: string;
  nodeHash: string;
};

/**
 * Computes deterministic Cryptographic Hash Chain for As-Built Dossier items (ADR-015 Section 2.6):
 * Hash_0 = SHA256(dossier_metadata)
 * Hash_i = SHA256(Hash_{i-1} || item_id_i || item_hash_i || sequence_i)
 */
export function buildDossierHashChain(
  items: readonly DossierChainItem[],
  metadata: Record<string, unknown> | string,
): { nodes: HashChainNode[]; sealedHash: string } {
  const metaString = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
  const hash0 = createHash('sha256').update(metaString, 'utf8').digest('hex').toLowerCase();

  const nodes: HashChainNode[] = [
    {
      index: 0,
      itemType: 'metadata',
      nodeHash: hash0,
    },
  ];

  let currentHash = hash0;
  const sortedItems = [...items].sort((a, b) => a.sequence - b.sequence);

  for (let i = 0; i < sortedItems.length; i += 1) {
    const item = sortedItems[i]!;
    const payload = `${currentHash}${item.itemId}${item.itemHash}${item.sequence}`;
    currentHash = createHash('sha256').update(payload, 'utf8').digest('hex').toLowerCase();

    nodes.push({
      index: i + 1,
      itemType: item.itemType,
      itemId: item.itemId,
      nodeHash: currentHash,
    });
  }

  return {
    nodes,
    sealedHash: currentHash,
  };
}
