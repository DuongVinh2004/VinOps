import { describe, expect, it } from 'vitest';
import { InMemoryRedisClient, RealtimeEventPublisher } from '../src/realtime-event-publisher.js';
import type { OutboxEvent } from '../src/outbox-publisher.js';

describe('RealtimeEventPublisher (ADR016-WRK-08)', () => {
  it('publishes matching domain events to Redis channel with latency < 50ms', async () => {
    const redis = new InMemoryRedisClient();
    const publisher = new RealtimeEventPublisher(redis);

    const event: OutboxEvent = {
      id: 'e1234567-89ab-cdef-0123-456789abcdef',
      aggregateType: 'field_issue',
      aggregateId: 'iss-999',
      eventType: 'field_issue.status_changed',
      payload: {
        issueId: 'iss-999',
        code: 'ISS-001',
        newStatus: 'Resolved',
      },
      publishAttempts: 1,
      tenant: {
        organizationId: 'org-101',
        projectId: 'proj-555',
      },
      correlationId: 'corr-001',
    };

    const result = await publisher.handleOutboxEvent(event);

    expect(result.published).toBe(true);
    expect(result.channel).toBe('vinops:realtime:proj-555:issues');
    expect(result.durationMs).toBeLessThan(50);

    expect(redis.publishedMessages).toHaveLength(1);
    const published = redis.publishedMessages[0]!;
    expect(published.channel).toBe('vinops:realtime:proj-555:issues');

    const parsed = JSON.parse(published.message) as Record<string, unknown>;
    expect(parsed['type']).toBe('field_issue.status_changed');
    expect(parsed['channel']).toBe('issues');
    expect(parsed['action']).toBe('status_changed');
    expect(parsed['eventId']).toBe('e1234567-89ab-cdef-0123-456789abcdef');
    expect(parsed['data']).toEqual(event.payload);
  });

  it('filters out non-realtime event types gracefully', async () => {
    const redis = new InMemoryRedisClient();
    const publisher = new RealtimeEventPublisher(redis);

    const nonRealtimeEvent: OutboxEvent = {
      id: 'e9999999-0000-0000-0000-000000000000',
      aggregateType: 'user_session',
      aggregateId: 'usr-1',
      eventType: 'auth.user_logged_in',
      payload: { userId: 'usr-1' },
      publishAttempts: 1,
      tenant: {
        organizationId: 'org-1',
        projectId: 'proj-1',
      },
      correlationId: 'corr-002',
    };

    const result = await publisher.handleOutboxEvent(nonRealtimeEvent);
    expect(result.published).toBe(false);
    expect(redis.publishedMessages).toHaveLength(0);
  });

  it('correctly publishes all catalog event types to respective channels', async () => {
    const redis = new InMemoryRedisClient();
    const publisher = new RealtimeEventPublisher(redis);

    const testCases: [string, string][] = [
      ['field_issue.assigned', 'issues'],
      ['rfi.status_changed', 'rfis'],
      ['rfi.ball_in_court_changed', 'rfis'],
      ['submittal.status_changed', 'submittals'],
      ['inspection.completed', 'inspections'],
      ['acceptance_record.signed', 'inspections'],
      ['document_revision.published', 'documents'],
      ['signing_session.completed', 'signatures'],
    ];

    for (const [eventType, expectedChannel] of testCases) {
      redis.clear();
      const event: OutboxEvent = {
        id: 'evt-test',
        aggregateType: 'test',
        aggregateId: 'test-1',
        eventType,
        payload: { test: true },
        publishAttempts: 1,
        tenant: { organizationId: 'org-1', projectId: 'p100' },
        correlationId: 'corr-test',
      };

      const result = await publisher.handleOutboxEvent(event);
      expect(result.published).toBe(true);
      expect(result.channel).toBe(`vinops:realtime:p100:${expectedChannel}`);
    }
  });
});
