import { describe, it, expect } from 'vitest';
import {
  calculateIoU,
  applyNonMaximumSuppression,
  classifyConfidence,
  type DetectionResult,
} from '../defect-detection-types.js';

describe('AI Defect Detection & NMS Filter', () => {
  describe('calculateIoU', () => {
    it('returns 1.0 for identical bounding boxes', () => {
      const box = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
      const iou = calculateIoU(box, box);
      expect(iou).toBeCloseTo(1.0, 4);
    });

    it('returns 0.0 for non-overlapping bounding boxes', () => {
      const boxA = { x: 0.0, y: 0.0, width: 0.2, height: 0.2 };
      const boxB = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
      const iou = calculateIoU(boxA, boxB);
      expect(iou).toBe(0.0);
    });

    it('calculates correct partial IoU for partially overlapping boxes', () => {
      // Box A: [0, 0] to [2, 2] -> Area = 4
      // Box B: [1, 0] to [3, 2] -> Area = 4
      // Intersection: [1, 0] to [2, 2] -> Area = 2
      // Union = 4 + 4 - 2 = 6
      // IoU = 2 / 6 = 0.3333
      const boxA = { x: 0, y: 0, width: 2, height: 2 };
      const boxB = { x: 1, y: 0, width: 2, height: 2 };
      const iou = calculateIoU(boxA, boxB);
      expect(iou).toBeCloseTo(2 / 6, 4);
    });
  });

  describe('applyNonMaximumSuppression', () => {
    it('suppresses lower confidence box when IoU > threshold for same class', () => {
      const detections: DetectionResult[] = [
        {
          type: 'honeycombing',
          confidence: 0.95,
          bbox: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
        },
        {
          type: 'honeycombing',
          confidence: 0.82,
          bbox: { x: 0.22, y: 0.21, width: 0.29, height: 0.3 }, // Overlaps heavily (~80% IoU)
        },
        {
          type: 'honeycombing',
          confidence: 0.75,
          bbox: { x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, // Different area
        },
      ];

      const filtered = applyNonMaximumSuppression(detections, 0.45);
      expect(filtered.length).toBe(2);
      expect(filtered[0]?.confidence).toBe(0.95);
      expect(filtered[1]?.confidence).toBe(0.75);
    });

    it('does not suppress boxes of different defect types even with overlap', () => {
      const detections: DetectionResult[] = [
        {
          type: 'crack',
          confidence: 0.92,
          bbox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
        },
        {
          type: 'water_damage',
          confidence: 0.88,
          bbox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, // Same area, different defect
        },
      ];

      const filtered = applyNonMaximumSuppression(detections, 0.45);
      expect(filtered.length).toBe(2);
    });
  });

  describe('classifyConfidence', () => {
    it('correctly classifies thresholds', () => {
      expect(classifyConfidence(0.95)).toBe('auto_tagged');
      expect(classifyConfidence(0.85)).toBe('auto_tagged');
      expect(classifyConfidence(0.84)).toBe('pending_review');
      expect(classifyConfidence(0.6)).toBe('pending_review');
      expect(classifyConfidence(0.59)).toBe('discard');
      expect(classifyConfidence(0.1)).toBe('discard');
    });
  });
});
