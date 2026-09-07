export type OutboxTenantContext = {
  organizationId: string | null;
  projectId: string | null;
};

export type OutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  publishAttempts: number;
  tenant: OutboxTenantContext;
  correlationId: string;
};

export type PublishedOutboxEvent = Pick<
  OutboxEvent,
  'id' | 'aggregateType' | 'aggregateId' | 'eventType' | 'tenant' | 'correlationId'
>;

export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export type InProcessOutboxHandler = (event: Readonly<OutboxEvent>) => Promise<void> | void;

/**
 * A deliberately local, deterministic adapter for the foundation release.
 * It gives the worker an idempotent publication boundary without introducing
 * an undeclared external broker.  A real broker adapter can later implement
 * the same OutboxPublisher interface.
 */
export class DeterministicInProcessPublisher implements OutboxPublisher {
  private readonly publishedEventIds = new Set<string>();
  private readonly deliveredEvents: PublishedOutboxEvent[] = [];

  constructor(private readonly handlers: readonly InProcessOutboxHandler[] = []) {}

  get deliveries(): readonly PublishedOutboxEvent[] {
    return this.deliveredEvents;
  }

  async publish(event: OutboxEvent): Promise<void> {
    if (this.publishedEventIds.has(event.id)) {
      return;
    }

    const immutableEvent: Readonly<OutboxEvent> = Object.freeze({
      ...event,
      tenant: Object.freeze({ ...event.tenant }),
      payload: Object.freeze({ ...event.payload }),
    });
    for (const handler of this.handlers) {
      await handler(immutableEvent);
    }

    this.publishedEventIds.add(event.id);
    this.deliveredEvents.push({
      id: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      tenant: { ...event.tenant },
      correlationId: event.correlationId,
    });
  }
}
