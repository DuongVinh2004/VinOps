export const detectionTypes = [
  'crack',
  'honeycombing',
  'rebar_exposure',
  'rebar_misalignment',
  'ppe_violation_hardhat',
  'ppe_violation_vest',
  'ppe_violation_harness',
  'formwork_defect',
  'water_damage',
] as const;

export type DetectionType = (typeof detectionTypes)[number];

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectionResult = {
  type: DetectionType;
  confidence: number;
  bbox: BoundingBox;
  metadata?: Record<string, unknown> | undefined;
};

export const ConfidenceThreshold = {
  AUTO_TAG: 0.85,
  REVIEW_PENDING: 0.6,
  DISCARD: 0.6,
} as const;

export type ReviewStatus =
  'auto_tagged' | 'pending_review' | 'confirmed' | 'rejected' | 'false_positive';

export function classifyConfidence(score: number): 'auto_tagged' | 'pending_review' | 'discard' {
  if (score >= ConfidenceThreshold.AUTO_TAG) {
    return 'auto_tagged';
  }
  if (score >= ConfidenceThreshold.REVIEW_PENDING) {
    return 'pending_review';
  }
  return 'discard';
}

export function calculateIoU(boxA: BoundingBox, boxB: BoundingBox): number {
  const xA = Math.max(boxA.x, boxB.x);
  const yA = Math.max(boxA.y, boxB.y);
  const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
  const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

  const intersectionWidth = Math.max(0, xB - xA);
  const intersectionHeight = Math.max(0, yB - yA);
  const intersectionArea = intersectionWidth * intersectionHeight;

  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const unionArea = areaA + areaB - intersectionArea;

  if (unionArea <= 0) {
    return 0;
  }
  return intersectionArea / unionArea;
}

export function applyNonMaximumSuppression(
  detections: readonly DetectionResult[],
  iouThreshold = 0.45,
): DetectionResult[] {
  if (detections.length === 0) return [];

  // Sort descending by confidence
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const selected: DetectionResult[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;

    const current = sorted[i]!;
    selected.push(current);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      const candidate = sorted[j]!;

      // Suppress if same class or high spatial overlap
      if (current.type === candidate.type) {
        const iou = calculateIoU(current.bbox, candidate.bbox);
        if (iou > iouThreshold) {
          suppressed.add(j);
        }
      }
    }
  }

  return selected;
}
