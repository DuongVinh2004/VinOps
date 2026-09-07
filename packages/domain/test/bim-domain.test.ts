import { describe, expect, it } from 'vitest';
import {
  canTransition,
  validActions,
  nextState,
  validateBcfViewpoint,
  safeValidateBcfViewpoint,
} from '../src/bim/index.js';
import { DomainError } from '../src/index.js';

describe('BIM Model State Machine', () => {
  it('allows valid transitions according to ADR-013 lifecycle', () => {
    expect(canTransition('draft', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'processing')).toBe(true);
    expect(canTransition('processing', 'ready')).toBe(true);
    expect(canTransition('processing', 'failed')).toBe(true);
    expect(canTransition('failed', 'reprocessing')).toBe(true);
    expect(canTransition('reprocessing', 'ready')).toBe(true);
    expect(canTransition('reprocessing', 'failed')).toBe(true);
    expect(canTransition('ready', 'archived')).toBe(true);

    // Invalid transitions
    expect(canTransition('draft', 'ready')).toBe(false);
    expect(canTransition('ready', 'processing')).toBe(false);
    expect(canTransition('archived', 'ready')).toBe(false);
  });

  it('returns valid actions for each state', () => {
    expect(validActions('draft')).toEqual(['upload']);
    expect(validActions('uploaded')).toEqual(['process']);
    expect(validActions('processing')).toEqual(['succeed', 'fail']);
    expect(validActions('failed')).toEqual(['reprocess']);
    expect(validActions('reprocessing')).toEqual(['reprocess_succeed', 'reprocess_fail']);
    expect(validActions('ready')).toEqual(['archive']);
    expect(validActions('archived')).toEqual([]);
  });

  it('computes next state correctly on valid action', () => {
    expect(nextState('draft', 'upload')).toBe('uploaded');
    expect(nextState('uploaded', 'process')).toBe('processing');
    expect(nextState('processing', 'succeed')).toBe('ready');
    expect(nextState('processing', 'fail')).toBe('failed');
    expect(nextState('failed', 'reprocess')).toBe('reprocessing');
    expect(nextState('reprocessing', 'reprocess_succeed')).toBe('ready');
    expect(nextState('reprocessing', 'reprocess_fail')).toBe('failed');
    expect(nextState('ready', 'archive')).toBe('archived');
  });

  it('throws DomainError on invalid action', () => {
    expect(() => nextState('draft', 'archive')).toThrow(DomainError);
    expect(() => nextState('draft', 'archive')).toThrowError(
      /Cannot perform action "archive" from state "draft"/,
    );
  });
});

describe('BCF Viewpoint Schema Validation', () => {
  it('validates a valid BCF viewpoint payload', () => {
    const validPayload = {
      camera: {
        position: { x: 10, y: 5, z: -15 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        fieldOfView: 60,
        projection: 'perspective' as const,
      },
      clippingPlanes: [
        {
          normal: { x: 0, y: 1, z: 0 },
          distance: 5.5,
        },
      ],
      highlightedGuids: ['3B4c8x$vD7A8mK1_eQ0zW1', '1A2b3c$dE5F6gH7_iJ8kL9'],
      hiddenGuids: ['2X3y4z$aB1C2dE3_fG4hI5'],
    };

    const parsed = validateBcfViewpoint(validPayload);
    expect(parsed.camera.position).toEqual({ x: 10, y: 5, z: -15 });
    expect(parsed.highlightedGuids).toHaveLength(2);
    expect(parsed.hiddenGuids).toHaveLength(1);
  });

  it('validates viewpoint with BCF camera naming (cameraViewPoint, etc.)', () => {
    const bcfPayload = {
      camera: {
        type: 'perspective',
        cameraViewPoint: { x: 12.45, y: 9.2, z: 8.75 },
        cameraDirection: { x: -0.707, y: -0.5, z: -0.5 },
        cameraUpVector: { x: 0.0, y: 1.0, z: 0.0 },
        fieldOfView: 60.0,
      },
      clippingPlanes: [
        {
          location: { x: 0.0, y: 8.0, z: 0.0 },
          direction: { x: 0.0, y: -1.0, z: 0.0 },
        },
      ],
      highlightedGuids: ['3B4c8x$vD7A8mK1_eQ0zW1'],
      hiddenGuids: [],
    };

    const parsed = validateBcfViewpoint(bcfPayload);
    expect(parsed.camera.position).toEqual({ x: 12.45, y: 9.2, z: 8.75 });
    expect(parsed.camera.target).toEqual({ x: -0.707, y: -0.5, z: -0.5 });
  });

  it('rejects invalid IFC GUID (length != 22)', () => {
    const invalidPayload = {
      camera: {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
        fieldOfView: 45,
        projection: 'perspective' as const,
      },
      highlightedGuids: ['too-short-guid'],
    };

    const result = safeValidateBcfViewpoint(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('rejects non-positive fieldOfView', () => {
    const invalidPayload = {
      camera: {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
        fieldOfView: -10,
        projection: 'perspective' as const,
      },
    };

    const result = safeValidateBcfViewpoint(invalidPayload);
    expect(result.success).toBe(false);
  });
});
