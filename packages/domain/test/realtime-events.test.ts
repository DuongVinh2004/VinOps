import { describe, expect, it } from 'vitest';
import {
  formatProjectRoom,
  isRealtimeEventType,
  mapEventTypeToChannel,
  parseProjectRoom,
  realtimeChannels,
  realtimeEventTypes,
  type RealtimeDomainEvent,
} from '../src/index.js';

describe('Realtime Events & Room Schema Catalog (ADR016-DOM-05)', () => {
  it('defines all required event types in the catalog', () => {
    expect(realtimeEventTypes).toContain('field_issue.status_changed');
    expect(realtimeEventTypes).toContain('field_issue.assigned');
    expect(realtimeEventTypes).toContain('rfi.status_changed');
    expect(realtimeEventTypes).toContain('rfi.ball_in_court_changed');
    expect(realtimeEventTypes).toContain('submittal.status_changed');
    expect(realtimeEventTypes).toContain('inspection.completed');
    expect(realtimeEventTypes).toContain('acceptance_record.signed');
    expect(realtimeEventTypes).toContain('document_revision.published');
    expect(realtimeEventTypes).toContain('signing_session.completed');
  });

  it('correctly maps event types to channels', () => {
    expect(mapEventTypeToChannel('field_issue.status_changed')).toBe('issues');
    expect(mapEventTypeToChannel('field_issue.assigned')).toBe('issues');
    expect(mapEventTypeToChannel('rfi.status_changed')).toBe('rfis');
    expect(mapEventTypeToChannel('rfi.ball_in_court_changed')).toBe('rfis');
    expect(mapEventTypeToChannel('submittal.status_changed')).toBe('submittals');
    expect(mapEventTypeToChannel('inspection.completed')).toBe('inspections');
    expect(mapEventTypeToChannel('acceptance_record.signed')).toBe('inspections');
    expect(mapEventTypeToChannel('document_revision.published')).toBe('documents');
    expect(mapEventTypeToChannel('signing_session.completed')).toBe('signatures');
  });

  it('formats and parses project rooms according to specification', () => {
    for (const channel of realtimeChannels) {
      const room = formatProjectRoom('proj-123', channel);
      expect(room).toBe(`project:proj-123:${channel}`);

      const parsed = parseProjectRoom(room);
      expect(parsed).toEqual({
        projectId: 'proj-123',
        channel,
      });
    }

    expect(parseProjectRoom('invalid-room-name')).toBeNull();
    expect(parseProjectRoom('project:123:unknown_channel')).toBeNull();
  });

  it('validates event type predicates', () => {
    expect(isRealtimeEventType('field_issue.status_changed')).toBe(true);
    expect(isRealtimeEventType('unknown.event')).toBe(false);
  });

  it('supports type-safe discriminated union events', () => {
    const event: RealtimeDomainEvent = {
      type: 'field_issue.status_changed',
      channel: 'issues',
      action: 'status_changed',
      eventId: 'evt-001',
      timestamp: new Date().toISOString(),
      data: {
        issueId: 'iss-123',
        code: 'ISS-001',
        previousStatus: 'Open',
        newStatus: 'In Progress',
      },
    };

    expect(event.type).toBe('field_issue.status_changed');
    expect(event.channel).toBe('issues');
    expect(event.data.newStatus).toBe('In Progress');
  });
});
