export type VisionSourceType =
  'field_issue_attachment' | 'inspection_evidence' | 'daily_log_photo' | 'standalone';

export type VisionJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type AiDetectionType =
  | 'crack'
  | 'honeycombing'
  | 'rebar_exposure'
  | 'rebar_misalignment'
  | 'ppe_violation_hardhat'
  | 'ppe_violation_vest'
  | 'ppe_violation_harness'
  | 'formwork_defect'
  | 'water_damage';

export type AiReviewStatus =
  'auto_tagged' | 'pending_review' | 'confirmed' | 'rejected' | 'false_positive';

export type SubmitVisionAnalysisRequest = {
  fileId: string;
  sourceType: VisionSourceType;
  sourceEntityId?: string | undefined;
  modelName?: string | undefined;
};

export type BoundingBoxContract = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DetectionResponse = {
  id: string;
  detectionType: AiDetectionType;
  confidenceScore: number;
  boundingBox: BoundingBoxContract;
  reviewStatus: AiReviewStatus;
  reviewedBy?: string | null | undefined;
  reviewedAt?: string | null | undefined;
  linkedFieldIssueId?: string | null | undefined;
  linkedInspectionFindingId?: string | null | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type VisionJobResponse = {
  jobId: string;
  projectId: string;
  sourceType: VisionSourceType;
  sourceEntityId?: string | null | undefined;
  fileId: string;
  status: VisionJobStatus;
  modelName: string;
  modelVersion: string;
  processingDurationMs?: number | null | undefined;
  errorMessage?: string | null | undefined;
  detections?: DetectionResponse[] | undefined;
  createdAt: string;
  updatedAt: string;
};

export type ReviewDetectionRequest = {
  reviewStatus: 'confirmed' | 'rejected' | 'false_positive';
  createFieldIssue?: boolean | undefined;
  issueTitle?: string | undefined;
  severity?: 'Low' | 'Medium' | 'High' | 'Critical' | undefined;
  assignedPartnerId?: string | undefined;
  linkedFieldIssueId?: string | undefined;
};

export type ReviewDetectionResponse = {
  detectionId: string;
  reviewStatus: AiReviewStatus;
  reviewedBy: string;
  reviewedAt: string;
  linkedFieldIssueId?: string | null | undefined;
  fieldIssueCode?: string | null | undefined;
};

export type CitedSource = {
  documentId?: string | undefined;
  documentRevisionId?: string | undefined;
  documentCode: string;
  documentTitle: string;
  clause: string;
  similarityScore: number;
};

export type RfiSuggestRequest = {
  suggestionType: 'answer_draft' | 'clarification_draft';
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  userQuestion?: string | undefined;
};

export type RfiSuggestionResponse = {
  suggestionId: string;
  rfiId: string;
  suggestionType: 'answer_draft' | 'clarification_draft';
  content: string;
  confidenceScore: number;
  citedSources: CitedSource[];
  llmModel: string;
  tokensUsed: {
    prompt: number;
    completion: number;
  };
  status: 'generated' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
};

export type ReviewRfiSuggestionRequest = {
  status: 'accepted' | 'rejected';
  finalContent?: string | undefined;
};
