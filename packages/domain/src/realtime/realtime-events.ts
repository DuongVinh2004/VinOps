/**
 * Realtime Event Catalog and Room Schema Specification (ADR-016 & PRSS v3.1).
 * Pure TypeScript definitions with zero framework dependencies.
 */

export const realtimeChannels = [
  'issues',
  'rfis',
  'submittals',
  'inspections',
  'documents',
  'signatures',
] as const;

export type RealtimeChannel = (typeof realtimeChannels)[number];

export const realtimeEventTypes = [
  'field_issue.status_changed',
  'field_issue.assigned',
  'rfi.status_changed',
  'rfi.ball_in_court_changed',
  'submittal.status_changed',
  'inspection.completed',
  'acceptance_record.signed',
  'document_revision.published',
  'signing_session.completed',
] as const;

export type RealtimeEventType = (typeof realtimeEventTypes)[number];

// Generic Realtime Event contract per ADR-016 Section 5.3
export type RealtimeEvent<T = unknown> = {
  type: string;
  channel: string;
  action: string;
  data: T;
  eventId: string;
  timestamp: string;
};

// Event payload structures
export interface FieldIssueStatusChangedData {
  issueId: string;
  code: string;
  previousStatus: string;
  newStatus: string;
  updatedBy?: {
    id: string;
    displayName?: string;
    partnerRole?: string;
  };
  locationId?: string;
  resolutionNote?: string;
}

export interface FieldIssueAssignedData {
  issueId: string;
  code: string;
  assigneeId: string;
  previousAssigneeId?: string;
  assignedBy?: {
    id: string;
    displayName?: string;
  };
}

export interface RfiStatusChangedData {
  rfiId: string;
  code: string;
  previousStatus: string;
  newStatus: string;
  updatedBy?: {
    id: string;
    displayName?: string;
  };
}

export interface RfiBallInCourtChangedData {
  rfiId: string;
  code: string;
  currentBallInCourt: string;
  previousBallInCourt?: string;
  deadline?: string;
}

export interface SubmittalStatusChangedData {
  submittalId: string;
  code: string;
  previousStatus: string;
  newStatus: string;
  currentBallInCourt?: string;
  deadline?: string;
}

export interface InspectionCompletedData {
  inspectionId: string;
  code: string;
  result: 'Pass' | 'Fail';
  completedAt: string;
  inspectorId: string;
}

export interface AcceptanceRecordSignedData {
  recordId: string;
  code: string;
  signerId: string;
  signerRole: string;
  signedAt: string;
  nextSignerRole?: string;
}

export interface DocumentRevisionPublishedData {
  documentId: string;
  revisionId: string;
  code: string;
  title: string;
  revisionNumber: number;
  publishedBy: string;
}

export interface SigningSessionCompletedData {
  sessionId: string;
  documentType: string;
  documentId: string;
  completedAt: string;
  finalStatus: string;
}

// Discriminated Union of all supported domain events
export type FieldIssueStatusChangedRealtimeEvent = {
  type: 'field_issue.status_changed';
  channel: 'issues';
  action: 'status_changed';
  data: FieldIssueStatusChangedData;
  eventId: string;
  timestamp: string;
};

export type FieldIssueAssignedRealtimeEvent = {
  type: 'field_issue.assigned';
  channel: 'issues';
  action: 'assigned';
  data: FieldIssueAssignedData;
  eventId: string;
  timestamp: string;
};

export type RfiStatusChangedRealtimeEvent = {
  type: 'rfi.status_changed';
  channel: 'rfis';
  action: 'status_changed';
  data: RfiStatusChangedData;
  eventId: string;
  timestamp: string;
};

export type RfiBallInCourtChangedRealtimeEvent = {
  type: 'rfi.ball_in_court_changed';
  channel: 'rfis';
  action: 'ball_in_court_changed';
  data: RfiBallInCourtChangedData;
  eventId: string;
  timestamp: string;
};

export type SubmittalStatusChangedRealtimeEvent = {
  type: 'submittal.status_changed';
  channel: 'submittals';
  action: 'status_changed';
  data: SubmittalStatusChangedData;
  eventId: string;
  timestamp: string;
};

export type InspectionCompletedRealtimeEvent = {
  type: 'inspection.completed';
  channel: 'inspections';
  action: 'completed';
  data: InspectionCompletedData;
  eventId: string;
  timestamp: string;
};

export type AcceptanceRecordSignedRealtimeEvent = {
  type: 'acceptance_record.signed';
  channel: 'inspections';
  action: 'signed';
  data: AcceptanceRecordSignedData;
  eventId: string;
  timestamp: string;
};

export type DocumentRevisionPublishedRealtimeEvent = {
  type: 'document_revision.published';
  channel: 'documents';
  action: 'published';
  data: DocumentRevisionPublishedData;
  eventId: string;
  timestamp: string;
};

export type SigningSessionCompletedRealtimeEvent = {
  type: 'signing_session.completed';
  channel: 'signatures';
  action: 'completed';
  data: SigningSessionCompletedData;
  eventId: string;
  timestamp: string;
};

export type RealtimeDomainEvent =
  | FieldIssueStatusChangedRealtimeEvent
  | FieldIssueAssignedRealtimeEvent
  | RfiStatusChangedRealtimeEvent
  | RfiBallInCourtChangedRealtimeEvent
  | SubmittalStatusChangedRealtimeEvent
  | InspectionCompletedRealtimeEvent
  | AcceptanceRecordSignedRealtimeEvent
  | DocumentRevisionPublishedRealtimeEvent
  | SigningSessionCompletedRealtimeEvent;

// Room naming convention: project:{projectId}:{channel}
export function formatProjectRoom(projectId: string, channel: RealtimeChannel): string {
  return `project:${projectId}:${channel}`;
}

export function parseProjectRoom(
  room: string,
): { projectId: string; channel: RealtimeChannel } | null {
  const parts = room.split(':');
  if (parts.length !== 3 || parts[0] !== 'project') {
    return null;
  }
  const channel = parts[2] as RealtimeChannel;
  if (!realtimeChannels.includes(channel)) {
    return null;
  }
  return { projectId: parts[1]!, channel };
}

export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return (realtimeEventTypes as readonly string[]).includes(value);
}

export function mapEventTypeToChannel(eventType: RealtimeEventType): RealtimeChannel {
  switch (eventType) {
    case 'field_issue.status_changed':
    case 'field_issue.assigned':
      return 'issues';
    case 'rfi.status_changed':
    case 'rfi.ball_in_court_changed':
      return 'rfis';
    case 'submittal.status_changed':
      return 'submittals';
    case 'inspection.completed':
    case 'acceptance_record.signed':
      return 'inspections';
    case 'document_revision.published':
      return 'documents';
    case 'signing_session.completed':
      return 'signatures';
  }
}
