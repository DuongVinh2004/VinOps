import { describe, expect, it, vi } from 'vitest';
import { RoomDispatcher } from '../room-dispatcher.js';

describe('RoomDispatcher Unit Tests (ADR016-TST-12)', () => {
  it('allows user in Project A to subscribe and receive Project A events', () => {
    const dispatcher = new RoomDispatcher();
    const socketId = 'sock-user-a';
    const userId = 'user-a';
    const projectAId = 'proj-a';
    const mockSend = vi.fn();

    // Register client with access to Project A
    dispatcher.registerClient(socketId, userId, [projectAId], mockSend);

    // Join Project A issues room
    const roomA = `project:${projectAId}:issues`;
    const joined = dispatcher.joinRoom(socketId, roomA);
    expect(joined).toBe(true);
    expect(dispatcher.getSubscribers(roomA)).toContain(socketId);

    // Dispatch event to Project A
    const eventA = {
      type: 'field_issue.status_changed',
      channel: 'issues',
      action: 'status_changed',
      eventId: 'evt-001',
      timestamp: new Date().toISOString(),
      data: { issueId: 'iss-1', code: 'ISS-01', newStatus: 'Resolved' },
    };

    const result = dispatcher.dispatch(roomA, eventA);
    expect(result.delivered).toBe(1);
    expect(result.recipientSocketIds).toContain(socketId);
    expect(mockSend).toHaveBeenCalledWith(JSON.stringify(eventA));
  });

  it('strictly blocks user without Project B access from receiving Project B events', () => {
    const dispatcher = new RoomDispatcher();
    const socketIdA = 'sock-user-a';
    const userIdA = 'user-a';
    const projectAId = 'proj-a';
    const projectBId = 'proj-b';
    const mockSendA = vi.fn();

    // User A only has Project A
    dispatcher.registerClient(socketIdA, userIdA, [projectAId], mockSendA);

    // User A attempts to join Project B room
    const roomB = `project:${projectBId}:issues`;
    const joinedB = dispatcher.joinRoom(socketIdA, roomB);
    expect(joinedB).toBe(false);
    expect(dispatcher.getSubscribers(roomB)).not.toContain(socketIdA);

    // User B joins Project B
    const socketIdB = 'sock-user-b';
    const userIdB = 'user-b';
    const mockSendB = vi.fn();
    dispatcher.registerClient(socketIdB, userIdB, [projectBId], mockSendB);
    expect(dispatcher.joinRoom(socketIdB, roomB)).toBe(true);

    // Dispatch event to Project B
    const eventB = {
      type: 'field_issue.status_changed',
      channel: 'issues',
      action: 'status_changed',
      eventId: 'evt-002',
      timestamp: new Date().toISOString(),
      data: { issueId: 'iss-2', code: 'ISS-02', newStatus: 'In Progress' },
    };

    const result = dispatcher.dispatch(roomB, eventB);
    expect(result.delivered).toBe(1);
    expect(result.recipientSocketIds).toContain(socketIdB);
    expect(result.recipientSocketIds).not.toContain(socketIdA);

    // Verify User A NEVER received Project B event
    expect(mockSendA).not.toHaveBeenCalled();
    expect(mockSendB).toHaveBeenCalledWith(JSON.stringify(eventB));
  });

  it('removes user from all project rooms immediately when user is removed from project', () => {
    const dispatcher = new RoomDispatcher();
    const socketId = 'sock-user-1';
    const userId = 'user-1';
    const projectAId = 'proj-a';
    const mockSend = vi.fn();

    dispatcher.registerClient(socketId, userId, [projectAId], mockSend);

    const issuesRoom = `project:${projectAId}:issues`;
    const rfisRoom = `project:${projectAId}:rfis`;

    expect(dispatcher.joinRoom(socketId, issuesRoom)).toBe(true);
    expect(dispatcher.joinRoom(socketId, rfisRoom)).toBe(true);
    expect(dispatcher.getSubscribers(issuesRoom)).toContain(socketId);
    expect(dispatcher.getSubscribers(rfisRoom)).toContain(socketId);

    // Remove user from Project A
    const leftRooms = dispatcher.removeUserFromProject(userId, projectAId);
    expect(leftRooms).toContain(issuesRoom);
    expect(leftRooms).toContain(rfisRoom);

    // Verify socket is removed from subscribers
    expect(dispatcher.getSubscribers(issuesRoom)).not.toContain(socketId);
    expect(dispatcher.getSubscribers(rfisRoom)).not.toContain(socketId);

    // Subsequent dispatch to Project A should not reach user
    const event = { type: 'field_issue.status_changed' };
    const result = dispatcher.dispatch(issuesRoom, event);
    expect(result.delivered).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('handles client unregister cleanly and leaves all active rooms', () => {
    const dispatcher = new RoomDispatcher();
    const socketId = 'sock-client-1';
    const userId = 'user-1';

    dispatcher.registerClient(socketId, userId, ['proj-1', 'proj-2']);
    dispatcher.joinRoom(socketId, 'project:proj-1:issues');
    dispatcher.joinRoom(socketId, 'project:proj-2:rfis');

    expect(dispatcher.getActiveClientCount()).toBe(1);
    expect(dispatcher.getActiveRoomCount()).toBe(2);

    dispatcher.unregisterClient(socketId);

    expect(dispatcher.getActiveClientCount()).toBe(0);
    expect(dispatcher.getActiveRoomCount()).toBe(0);
  });

  it('supports autoJoinProjectRooms for all accessible project channels', () => {
    const dispatcher = new RoomDispatcher();
    const socketId = 'sock-auto-join';
    const userId = 'user-auto';

    dispatcher.registerClient(socketId, userId, ['proj-x', 'proj-y']);

    const joined = dispatcher.autoJoinProjectRooms(socketId, ['issues', 'rfis']);
    expect(joined).toEqual([
      'project:proj-x:issues',
      'project:proj-x:rfis',
      'project:proj-y:issues',
      'project:proj-y:rfis',
    ]);
  });
});
