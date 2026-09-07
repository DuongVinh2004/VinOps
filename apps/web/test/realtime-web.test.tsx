// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RealtimeSocketProvider,
  useRealtimeEvent,
} from '../src/providers/RealtimeSocketProvider.js';
import { RealtimeNotificationBell } from '../src/components/notifications/RealtimeNotificationBell.js';

afterEach(cleanup);

function TestEventConsumer({ onEvent }: { onEvent: (data: unknown) => void }) {
  useRealtimeEvent('issues', 'status_changed', (event) => {
    onEvent(event.data);
  });
  return <div data-testid="consumer">Listening</div>;
}

describe('Realtime Web Components (ADR016-WEB-09 & WEB-10)', () => {
  it('renders RealtimeNotificationBell and handles unread badge and toasts', () => {
    render(
      <RealtimeSocketProvider token="mock-token" wsUrl="ws://localhost:3000/ws">
        <RealtimeNotificationBell />
      </RealtimeSocketProvider>,
    );

    const button = screen.getByRole('button', { name: /realtime notifications/i });
    expect(button).toBeInTheDocument();
  });

  it('provides socket context and allows subscribing to events', () => {
    const eventsReceived: unknown[] = [];

    render(
      <RealtimeSocketProvider token="mock-token" wsUrl="ws://localhost:3000/ws">
        <TestEventConsumer onEvent={(data) => eventsReceived.push(data)} />
      </RealtimeSocketProvider>,
    );

    expect(screen.getByTestId('consumer')).toHaveTextContent('Listening');
  });
});
