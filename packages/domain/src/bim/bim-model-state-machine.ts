import { DomainError } from '../errors.js';

export const bimModelStates = [
  'draft',
  'uploaded',
  'processing',
  'reprocessing',
  'ready',
  'failed',
  'archived',
] as const;
export type BimModelState = (typeof bimModelStates)[number];

export const bimModelActions = [
  'upload',
  'process',
  'succeed',
  'fail',
  'reprocess',
  'reprocess_succeed',
  'reprocess_fail',
  'archive',
] as const;
export type BimModelAction = (typeof bimModelActions)[number];

export type BimDiscipline =
  | 'architectural'
  | 'structural'
  | 'mep'
  | 'infrastructure'
  | 'landscape'
  | 'coordination'
  | 'as_built';

export type BimEntityType =
  'field_issue' | 'rfi_request' | 'inspection' | 'acceptance_record' | 'location_node';

const transitions: Record<BimModelState, Partial<Record<BimModelAction, BimModelState>>> = {
  draft: {
    upload: 'uploaded',
  },
  uploaded: {
    process: 'processing',
  },
  processing: {
    succeed: 'ready',
    fail: 'failed',
  },
  failed: {
    reprocess: 'reprocessing',
  },
  reprocessing: {
    reprocess_succeed: 'ready',
    reprocess_fail: 'failed',
  },
  ready: {
    archive: 'archived',
  },
  archived: {},
};

export function canTransition(from: BimModelState, to: BimModelState): boolean {
  const allowed = transitions[from];
  if (allowed === undefined) {
    return false;
  }
  return Object.values(allowed).includes(to);
}

export function validActions(currentState: BimModelState): readonly BimModelAction[] {
  const allowed = transitions[currentState];
  if (allowed === undefined) {
    return [];
  }
  return Object.keys(allowed) as BimModelAction[];
}

export function nextState(current: BimModelState, action: BimModelAction): BimModelState {
  const allowed = transitions[current];
  const target = allowed ? allowed[action] : undefined;
  if (target === undefined) {
    throw new DomainError(
      'INVALID_BIM_MODEL_TRANSITION',
      `Cannot perform action "${action}" from state "${current}".`,
    );
  }
  return target;
}

export const bimCanTransition = canTransition;
export const bimValidActions = validActions;
export const nextBimState = nextState;
