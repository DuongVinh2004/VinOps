import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  calculateWorkingDaysBetween,
  computeRfiBallInCourt,
  computeSubmittalBallInCourt,
  evaluateSlaStatus,
  isWorkingDay,
  reviewDecisionToSubmittalAction,
  rfiTransitionTarget,
  submittalTransitionTarget,
} from '../src/rfx/index.js';
import { DomainError } from '../src/errors.js';

describe('RFX Domain', () => {
  describe('RFI State Machine', () => {
    it('handles standard RFI lifecycle transitions', () => {
      expect(rfiTransitionTarget('Draft', 'submit')).toBe('Submitted');
      expect(rfiTransitionTarget('Submitted', 'start_review')).toBe('Under Review');
      expect(rfiTransitionTarget('Under Review', 'request_clarification')).toBe(
        'Clarification Required',
      );
      expect(rfiTransitionTarget('Clarification Required', 'provide_clarification')).toBe(
        'Under Review',
      );
      expect(rfiTransitionTarget('Under Review', 'answer_official')).toBe('Official Answered');
      expect(rfiTransitionTarget('Official Answered', 'close')).toBe('Closed');
      expect(rfiTransitionTarget('Closed', 'reopen')).toBe('Under Review');
    });

    it('rejects invalid RFI transitions', () => {
      expect(() => rfiTransitionTarget('Draft', 'answer_official')).toThrow(DomainError);
      expect(() => rfiTransitionTarget('Submitted', 'close')).toThrow(DomainError);
      expect(() => rfiTransitionTarget('Under Review', 'submit')).toThrow(DomainError);
    });
  });

  describe('Submittal Maker-Checker State Machine', () => {
    it('handles maker-checker reviews and approvals', () => {
      expect(submittalTransitionTarget('Draft', 'submit')).toBe('Submitted');
      expect(submittalTransitionTarget('Submitted', 'start_review')).toBe('Under Review');
      expect(submittalTransitionTarget('Under Review', 'approve')).toBe('Approved');
      expect(submittalTransitionTarget('Approved', 'close')).toBe('Closed');

      expect(submittalTransitionTarget('Under Review', 'request_revision')).toBe(
        'Revise and Resubmit',
      );
      expect(submittalTransitionTarget('Revise and Resubmit', 'resubmit')).toBe('Submitted');

      expect(submittalTransitionTarget('Under Review', 'reject')).toBe('Rejected');
    });

    it('maps review decisions to submittal actions', () => {
      expect(reviewDecisionToSubmittalAction('Approved')).toBe('approve');
      expect(reviewDecisionToSubmittalAction('Approved with Comments')).toBe(
        'approve_with_comments',
      );
      expect(reviewDecisionToSubmittalAction('Revise and Resubmit')).toBe('request_revision');
      expect(reviewDecisionToSubmittalAction('Rejected')).toBe('reject');
    });
  });

  describe('SLA Business Days & Calendar', () => {
    const calendar = {
      workingDays: [1, 2, 3, 4, 5], // Mon-Fri
      holidays: ['2026-09-02'], // National Day holiday
    };

    it('identifies working days correctly', () => {
      // 2026-09-01 is Tuesday -> true
      expect(isWorkingDay(new Date('2026-09-01T08:00:00Z'), calendar)).toBe(true);
      // 2026-09-02 is Wednesday holiday -> false
      expect(isWorkingDay(new Date('2026-09-02T08:00:00Z'), calendar)).toBe(false);
      // 2026-09-05 is Saturday -> false
      expect(isWorkingDay(new Date('2026-09-05T08:00:00Z'), calendar)).toBe(false);
      // 2026-09-06 is Sunday -> false
      expect(isWorkingDay(new Date('2026-09-06T08:00:00Z'), calendar)).toBe(false);
    });

    it('adds working days skipping weekends and holidays', () => {
      const start = new Date('2026-09-01T08:00:00Z'); // Tuesday
      // 1 day -> skip 2026-09-02 (holiday) -> 2026-09-03 (Thursday)
      const due1 = addWorkingDays(start, 1, calendar);
      expect(due1.toISOString().slice(0, 10)).toBe('2026-09-03');

      // 3 working days:
      // Day 1: 09-03 (Thu)
      // Day 2: 09-04 (Fri)
      // Skip 09-05 (Sat), 09-06 (Sun)
      // Day 3: 09-07 (Mon)
      const due3 = addWorkingDays(start, 3, calendar);
      expect(due3.toISOString().slice(0, 10)).toBe('2026-09-07');
    });

    it('calculates working days between two dates', () => {
      const start = new Date('2026-09-01T00:00:00Z'); // Tue
      const end = new Date('2026-09-08T00:00:00Z'); // Next Tue
      // 09-01 (Tue: 1), 09-02 (Wed holiday: 0), 09-03 (Thu: 1), 09-04 (Fri: 1), 09-05 (Sat: 0), 09-06 (Sun: 0), 09-07 (Mon: 1) = 4 days
      const days = calculateWorkingDaysBetween(start, end, calendar);
      expect(days).toBe(4);
    });

    it('evaluates SLA status and warnings', () => {
      const now = new Date('2026-09-07T12:00:00Z');
      // Overdue
      const past = new Date('2026-09-07T10:00:00Z');
      expect(evaluateSlaStatus(past, now).status).toBe('breached');

      // Within 24h
      const in12h = new Date('2026-09-08T00:00:00Z');
      expect(evaluateSlaStatus(in12h, now).status).toBe('warning_24h');

      // Within 48h
      const in36h = new Date('2026-09-09T00:00:00Z');
      expect(evaluateSlaStatus(in36h, now).status).toBe('warning_48h');

      // Plenty of time
      const in72h = new Date('2026-09-10T12:00:00Z');
      expect(evaluateSlaStatus(in72h, now).status).toBe('ok');
    });
  });

  describe('Ball-in-Court', () => {
    const rfiParties = {
      requestingPartnerOrganizationId: 'contractor-1',
      respondingPartnerOrganizationId: 'consultant-1',
    };

    it('computes correct ball-in-court for RFI states', () => {
      expect(computeRfiBallInCourt('Draft', rfiParties)).toBe('contractor-1');
      expect(computeRfiBallInCourt('Submitted', rfiParties)).toBe('consultant-1');
      expect(computeRfiBallInCourt('Under Review', rfiParties)).toBe('consultant-1');
      expect(computeRfiBallInCourt('Clarification Required', rfiParties)).toBe('contractor-1');
      expect(computeRfiBallInCourt('Official Answered', rfiParties)).toBe('contractor-1');
      expect(computeRfiBallInCourt('Closed', rfiParties)).toBeNull();
    });

    const submittalParties = {
      makerPartnerOrganizationId: 'subcontractor-1',
      leadContractorPartnerOrganizationId: 'main-contractor-1',
      consultantPartnerOrganizationId: 'consultant-lead-1',
    };

    it('computes correct ball-in-court for Submittal states', () => {
      expect(computeSubmittalBallInCourt('Draft', submittalParties)).toBe('subcontractor-1');
      expect(computeSubmittalBallInCourt('Submitted', submittalParties)).toBe('main-contractor-1');
      expect(computeSubmittalBallInCourt('Under Review', submittalParties)).toBe(
        'consultant-lead-1',
      );
      expect(computeSubmittalBallInCourt('Revise and Resubmit', submittalParties)).toBe(
        'subcontractor-1',
      );
      expect(computeSubmittalBallInCourt('Approved', submittalParties)).toBe('main-contractor-1');
      expect(computeSubmittalBallInCourt('Closed', submittalParties)).toBeNull();
    });
  });
});
