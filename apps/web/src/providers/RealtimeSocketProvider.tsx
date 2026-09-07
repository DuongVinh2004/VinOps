import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface RealtimeEvent<T = unknown> {
  type: string;
  channel: string;
  action: string;
  data: T;
  eventId: string;
  timestamp: string;
}

export type SocketConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RealtimeSocketContextValue {
  status: SocketConnectionStatus;
  lastEvent: RealtimeEvent | null;
  subscribe: (channel: string, projectId: string) => void;
  unsubscribe: (channel: string, projectId: string) => void;
  activeRooms: readonly string[];
  recentEvents: readonly RealtimeEvent[];
}

const RealtimeSocketContext = createContext<RealtimeSocketContextValue | null>(null);

export interface RealtimeSocketProviderProps {
  children: ReactNode;
  wsUrl?: string | undefined;
  token?: string | null | undefined;
  projectId?: string | null | undefined;
  reconnectBaseMs?: number | undefined;
  reconnectMaxMs?: number | undefined;
  mockSocket?: WebSocket | undefined;
}

const MAX_DEDUPLICATION_RING_SIZE = 500;

export function RealtimeSocketProvider({
  children,
  wsUrl,
  token,
  projectId,
  reconnectBaseMs = 1000,
  reconnectMaxMs = 30000,
  mockSocket,
}: RealtimeSocketProviderProps) {
  const [status, setStatus] = useState<SocketConnectionStatus>('disconnected');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [activeRooms, setActiveRooms] = useState<string[]>([]);
  const [recentEvents, setRecentEvents] = useState<RealtimeEvent[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedRoomsRef = useRef<Set<string>>(new Set());

  // Circular buffer ring for 500 eventIds de-duplication (ADR-016 Section 2.4)
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const ringBufferRef = useRef<string[]>([]);

  const isDuplicateEvent = useCallback((eventId: string): boolean => {
    if (!eventId) return false;
    if (seenEventIdsRef.current.has(eventId)) {
      return true;
    }
    seenEventIdsRef.current.add(eventId);
    ringBufferRef.current.push(eventId);

    if (ringBufferRef.current.length > MAX_DEDUPLICATION_RING_SIZE) {
      const oldest = ringBufferRef.current.shift();
      if (oldest) {
        seenEventIdsRef.current.delete(oldest);
      }
    }
    return false;
  }, []);

  const subscribe = useCallback((channel: string, targetProjectId: string) => {
    const room = `project:${targetProjectId}:${channel}`;
    subscribedRoomsRef.current.add(room);
    setActiveRooms([...subscribedRoomsRef.current]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          action: 'subscribe',
          channel,
          projectId: targetProjectId,
        }),
      );
    }
  }, []);

  const unsubscribe = useCallback((channel: string, targetProjectId: string) => {
    const room = `project:${targetProjectId}:${channel}`;
    subscribedRoomsRef.current.delete(room);
    setActiveRooms([...subscribedRoomsRef.current]);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          action: 'unsubscribe',
          channel,
          projectId: targetProjectId,
        }),
      );
    }
  }, []);

  const connect = useCallback(() => {
    if (!token) {
      setStatus('disconnected');
      return;
    }

    if (mockSocket) {
      socketRef.current = mockSocket;
      setStatus('connected');
      return;
    }

    const endpoint =
      wsUrl ||
      (typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
        : 'ws://localhost:3000/ws');

    const urlWithParams = new URL(endpoint);
    urlWithParams.searchParams.set('token', token);
    if (projectId) {
      urlWithParams.searchParams.set('projectId', projectId);
    }

    setStatus('connecting');

    try {
      const socket = new WebSocket(urlWithParams.toString());
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        reconnectAttemptRef.current = 0;

        // Auto-rejoin rooms
        for (const room of subscribedRoomsRef.current) {
          const parts = room.split(':');
          if (parts.length === 3 && parts[1] && parts[2]) {
            socket.send(
              JSON.stringify({
                action: 'subscribe',
                projectId: parts[1],
                channel: parts[2],
              }),
            );
          }
        }
      };

      socket.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(messageEvent.data as string) as Record<string, unknown>;

          // Ping/pong check
          if (parsed['type'] === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          const event = parsed as unknown as RealtimeEvent;
          if (event.eventId && isDuplicateEvent(event.eventId)) {
            // Deduplicated
            return;
          }

          setLastEvent(event);
          setRecentEvents((prev) => [event, ...prev].slice(0, 50));
        } catch {
          // Ignored non-JSON message
        }
      };

      socket.onerror = () => {
        setStatus('error');
      };

      socket.onclose = () => {
        if (!isMountedRef.current) {
          return;
        }
        setStatus('disconnected');
        socketRef.current = null;

        // Reconnect with exponential backoff
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(
          reconnectBaseMs * Math.pow(2, attempt) + Math.random() * 500,
          reconnectMaxMs,
        );
        reconnectAttemptRef.current += 1;

        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect();
          }
        }, delay);
      };
    } catch {
      setStatus('error');
    }
  }, [token, projectId, wsUrl, isDuplicateEvent, reconnectBaseMs, reconnectMaxMs, mockSocket]);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.onmessage = null;
        socketRef.current.onopen = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  const value: RealtimeSocketContextValue = {
    status,
    lastEvent,
    subscribe,
    unsubscribe,
    activeRooms,
    recentEvents,
  };

  return <RealtimeSocketContext.Provider value={value}>{children}</RealtimeSocketContext.Provider>;
}

export function useRealtimeSocket(): RealtimeSocketContextValue {
  const context = useContext(RealtimeSocketContext);
  if (!context) {
    throw new Error('useRealtimeSocket must be used within RealtimeSocketProvider');
  }
  return context;
}

export function useRealtimeEvent<T = unknown>(
  channel: string,
  actionOrCallback: string | ((event: RealtimeEvent<T>) => void),
  optionalCallback?: (event: RealtimeEvent<T>) => void,
): void {
  const { lastEvent } = useRealtimeSocket();

  const action = typeof actionOrCallback === 'string' ? actionOrCallback : undefined;
  const callback = typeof actionOrCallback === 'function' ? actionOrCallback : optionalCallback;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.channel === channel) {
      if (!action || lastEvent.action === action) {
        callbackRef.current?.(lastEvent as RealtimeEvent<T>);
      }
    }
  }, [lastEvent, channel, action]);
}
