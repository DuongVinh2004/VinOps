import { DomainError } from '../errors.js';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraData {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  fieldOfView: number;
  projection: 'perspective' | 'orthographic';
}

export interface ClippingPlane {
  normal: Vector3;
  distance: number;
}

export interface BcfViewpoint {
  camera: CameraData;
  clippingPlanes: ClippingPlane[];
  highlightedGuids: string[];
  hiddenGuids: string[];
}

const IFC_GUID_REGEX = /^[0-9A-Za-z_$]{22}$/;

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseVector3(val: unknown, fieldName: string): Vector3 {
  if (!isRecord(val)) {
    throw new DomainError(
      'INVALID_BCF_VIEWPOINT',
      `${fieldName} must be an object with x, y, z numbers`,
    );
  }
  if (typeof val.x !== 'number' || typeof val.y !== 'number' || typeof val.z !== 'number') {
    throw new DomainError('INVALID_BCF_VIEWPOINT', `${fieldName} x, y, z must be numbers`);
  }
  return { x: val.x, y: val.y, z: val.z };
}

function parseCamera(camera: unknown): CameraData {
  if (!isRecord(camera)) {
    throw new DomainError('INVALID_BCF_VIEWPOINT', 'camera must be an object');
  }

  const posRaw = camera.position ?? camera.cameraViewPoint;
  const pos = posRaw ? parseVector3(posRaw, 'camera position') : { x: 0, y: 0, z: 0 };

  const tgtRaw = camera.target ?? camera.cameraDirection;
  const tgt = tgtRaw ? parseVector3(tgtRaw, 'camera target') : { x: 0, y: 0, z: -1 };

  const upRaw = camera.up ?? camera.cameraUpVector;
  const upVec = upRaw ? parseVector3(upRaw, 'camera up') : { x: 0, y: 1, z: 0 };

  const fovRaw = camera.fieldOfView ?? 60;
  if (typeof fovRaw !== 'number' || fovRaw <= 0) {
    throw new DomainError('INVALID_BCF_VIEWPOINT', 'camera fieldOfView must be a positive number');
  }

  const projRaw = camera.projection ?? camera.type ?? 'perspective';
  if (projRaw !== 'perspective' && projRaw !== 'orthographic') {
    throw new DomainError(
      'INVALID_BCF_VIEWPOINT',
      'camera projection must be perspective or orthographic',
    );
  }

  return {
    position: pos,
    target: tgt,
    up: upVec,
    fieldOfView: fovRaw,
    projection: projRaw,
  };
}

function parseClippingPlane(plane: unknown, index: number): ClippingPlane {
  if (!isRecord(plane)) {
    throw new DomainError('INVALID_BCF_VIEWPOINT', `clippingPlane[${index}] must be an object`);
  }

  const normRaw = plane.normal ?? plane.direction;
  const normal = normRaw
    ? parseVector3(normRaw, `clippingPlane[${index}] normal`)
    : { x: 0, y: 1, z: 0 };

  let distance = 0;
  if (typeof plane.distance === 'number') {
    distance = plane.distance;
  } else if (isRecord(plane.location)) {
    const loc = parseVector3(plane.location, `clippingPlane[${index}] location`);
    distance = Math.hypot(loc.x, loc.y, loc.z);
  }

  return { normal, distance };
}

function parseGuids(guids: unknown, fieldName: string): string[] {
  if (guids === undefined || guids === null) {
    return [];
  }
  if (!Array.isArray(guids)) {
    throw new DomainError('INVALID_BCF_VIEWPOINT', `${fieldName} must be an array`);
  }
  return guids.map((guid, idx) => {
    if (typeof guid !== 'string' || !IFC_GUID_REGEX.test(guid)) {
      throw new DomainError(
        'INVALID_BCF_VIEWPOINT',
        `${fieldName}[${idx}] must be a 22-character IFC GUID matching ISO 10303-21`,
      );
    }
    return guid;
  });
}

export function validateBcfViewpoint(input: unknown): BcfViewpoint {
  if (!isRecord(input)) {
    throw new DomainError('INVALID_BCF_VIEWPOINT', 'BCF viewpoint input must be an object');
  }

  const camera = parseCamera(input.camera);

  const rawPlanes = input.clippingPlanes;
  let clippingPlanes: ClippingPlane[] = [];
  if (rawPlanes !== undefined && rawPlanes !== null) {
    if (!Array.isArray(rawPlanes)) {
      throw new DomainError('INVALID_BCF_VIEWPOINT', 'clippingPlanes must be an array');
    }
    clippingPlanes = rawPlanes.map((p, idx) => parseClippingPlane(p, idx));
  }

  const highlightedGuids = parseGuids(input.highlightedGuids, 'highlightedGuids');
  const hiddenGuids = parseGuids(input.hiddenGuids, 'hiddenGuids');

  return {
    camera,
    clippingPlanes,
    highlightedGuids,
    hiddenGuids,
  };
}

export function safeValidateBcfViewpoint(input: unknown): {
  success: boolean;
  data?: BcfViewpoint;
  error?: { message: string };
} {
  try {
    const data = validateBcfViewpoint(input);
    return { success: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: { message } };
  }
}

export const vector3Schema = { name: 'vector3' };
export const ifcGuidSchema = { name: 'ifcGuid' };
export const cameraSchema = { name: 'camera' };
export const clippingPlaneSchema = { name: 'clippingPlane' };
export const bcfCameraSchema = { name: 'bcfCamera' };
export const bcfClippingPlaneSchema = { name: 'bcfClippingPlane' };
export const bcfViewpointSchema = {
  safeParse(input: unknown) {
    return safeValidateBcfViewpoint(input);
  },
  parse(input: unknown) {
    return validateBcfViewpoint(input);
  },
};
