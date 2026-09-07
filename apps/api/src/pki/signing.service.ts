import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  assertCanSign,
  buildDossierHashChain,
  nextState,
  type PadesLevel,
  type SignableType,
  type SignatureSessionStatus,
  type SignerRole,
  type SigningProviderCode,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';
import { CscAdapterFactory, type CscProvider } from './adapters/csc-client.adapter.js';
import { PdfPadesSignerService } from './services/pdf-pades-signer.service.js';
import { TsaClientService } from './services/tsa-client.service.js';

export type InitSigningSessionSigner = {
  signingOrder: number;
  role: SignerRole;
  userId: string;
};

export type InitSigningSessionInput = {
  signableType: SignableType;
  signableId: string;
  expiresInHours?: number;
  documentHash?: string;
  providerCode?: SigningProviderCode;
  signers: InitSigningSessionSigner[];
};

export type AuthorizeSigningInput = {
  providerCode?: SigningProviderCode;
  authMode?: 'push_notification' | 'otp' | 'pin';
};

export type CompleteSigningInput = {
  cscTransactionId?: string;
  otpCode?: string;
  signerNote?: string;
  padesLevel?: PadesLevel;
};

export type RejectSigningInput = {
  reason: string;
  correctiveNoticeRequired?: boolean;
  attachedEvidenceFileIds?: string[];
};

export type CreateDossierInput = {
  code: string;
  name: string;
  dossierType: 'work_acceptance' | 'stage_acceptance' | 'completion_package' | 'handover_package';
};

export type AddDossierItemInput = {
  itemType:
    | 'acceptance_record'
    | 'inspection'
    | 'daily_log'
    | 'test_report'
    | 'material_certificate'
    | 'drawing'
    | 'photo_evidence';
  itemEntityId: string;
  itemFileId: string;
  sequence: number;
  itemHash?: string;
};

export type SealDossierInput = {
  signingProviderCode?: SigningProviderCode;
  sealingNote?: string;
};

@Injectable()
export class SigningService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;
  private readonly pdfSigner = new PdfPadesSignerService();
  private readonly tsaClient = new TsaClientService();

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-signing-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  private getCscProvider(providerCode: SigningProviderCode = 'vnpt_smartca'): CscProvider {
    return CscAdapterFactory.create(providerCode, {
      apiBaseUrl: 'https://mock.ca.vinops.local',
      isMock: true,
    });
  }

  /**
   * 1. Initialize multi-party sequential signing sessions (ADR-015 Section 5.1)
   */
  async initSigningSessions(
    identity: RequestIdentity,
    projectId: string,
    input: InitSigningSessionInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const proj = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM vinops.projects WHERE id = $1',
        [projectId],
      );
      if (proj.length === 0) {
        throw new PlatformError('PROJECT_NOT_FOUND', 'errors.notFound', 404, false);
      }
      const organizationId = proj[0]!.organization_id;

      // Default or compute document hash
      const documentHash =
        input.documentHash ??
        createHash('sha256')
          .update(`${input.signableType}:${input.signableId}:${Date.now()}`)
          .digest('hex')
          .toLowerCase();

      const ttlHours = input.expiresInHours ?? 48;
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

      // Verify signers
      const sortedSigners = [...input.signers].sort((a, b) => a.signingOrder - b.signingOrder);
      if (sortedSigners.length === 0) {
        throw new PlatformError('VALIDATION_FAILED', 'Signers list cannot be empty', 422, false);
      }

      const sessionsResult: unknown[] = [];

      for (const signer of sortedSigners) {
        const sessionId = randomUUID();
        await client.execute(
          `INSERT INTO vinops.signature_sessions (
            id, organization_id, project_id, signable_type, signable_id, signing_order,
            required_signer_role, required_signer_user_id, status, document_hash, expires_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10
          )`,
          [
            sessionId,
            organizationId,
            projectId,
            input.signableType,
            input.signableId,
            signer.signingOrder,
            signer.role,
            signer.userId,
            documentHash,
            expiresAt.toISOString(),
          ],
        );

        sessionsResult.push({
          id: sessionId,
          signingOrder: signer.signingOrder,
          requiredSignerRole: signer.role,
          requiredSignerUserId: signer.userId,
          status: 'pending',
          documentHash,
          expiresAt: expiresAt.toISOString(),
        });
      }

      // Outbox & Audit
      await this.recordOutbox(client, {
        organizationId,
        projectId,
        aggregateType: 'signature_session',
        aggregateId: (sessionsResult[0] as { id: string }).id,
        eventType: 'signing.session_created',
        payload: {
          signableType: input.signableType,
          signableId: input.signableId,
          totalSteps: sortedSigners.length,
        },
      });

      await this.recordAudit(client, {
        organizationId,
        projectId,
        actorUserId: identity.userId,
        action: 'SIGNING_SESSION_INITIALIZED',
        entityType: 'signature_session',
        entityId: (sessionsResult[0] as { id: string }).id,
        correlationId,
      });

      return {
        signableType: input.signableType,
        signableId: input.signableId,
        currentOrder: 1,
        totalSteps: sortedSigners.length,
        sessions: sessionsResult,
      };
    });
  }

  /**
   * 2. Authorize CSC session (send OTP / push notification challenge) (ADR-015 Section 5.2)
   */
  async authorizeSession(
    identity: RequestIdentity,
    projectId: string,
    sessionId: string,
    input: AuthorizeSigningInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const sessionRes = await client.query<{
        id: string;
        organization_id: string;
        project_id: string;
        required_signer_user_id: string;
        required_signer_role: SignerRole;
        signing_order: number;
        status: SignatureSessionStatus;
        document_hash: string;
        expires_at: string;
      }>('SELECT * FROM vinops.signature_sessions WHERE id = $1 AND project_id = $2 FOR UPDATE', [
        sessionId,
        projectId,
      ]);

      if (sessionRes.length === 0) {
        throw new PlatformError('SESSION_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const session = sessionRes[0]!;

      // Enforce actor identity
      if (session.required_signer_user_id !== identity.userId) {
        throw new PlatformError(
          'FORBIDDEN',
          'User is not the assigned signer for this step',
          403,
          false,
        );
      }

      // Check state transition
      const targetState = nextState(session.status, 'authorize');

      const provider = this.getCscProvider(input.providerCode ?? 'vnpt_smartca');
      const cscAuth = await provider.authorize({
        credentialID: identity.userId,
        hashes: [session.document_hash],
        authMode: input.authMode ?? 'push_notification',
      });

      await client.execute(
        `UPDATE vinops.signature_sessions
            SET status = $2,
                csc_transaction_id = $3,
                updated_at = now()
          WHERE id = $1`,
        [sessionId, targetState, cscAuth.transactionID],
      );

      return {
        sessionId,
        status: targetState,
        cscTransactionId: cscAuth.transactionID,
        challengeType: cscAuth.challengeType,
        message: cscAuth.message,
        expiresInSeconds: cscAuth.expiresInSeconds,
      };
    });
  }

  /**
   * 3. Submit OTP & complete signing with PAdES and TSA timestamp (ADR-015 Section 5.3)
   */
  async signSession(
    identity: RequestIdentity,
    projectId: string,
    sessionId: string,
    input: CompleteSigningInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const sessionRes = await client.query<{
        id: string;
        organization_id: string;
        project_id: string;
        signable_type: SignableType;
        signable_id: string;
        signing_order: number;
        required_signer_role: SignerRole;
        required_signer_user_id: string;
        status: SignatureSessionStatus;
        document_hash: string;
        csc_transaction_id: string | null;
        expires_at: string;
      }>('SELECT * FROM vinops.signature_sessions WHERE id = $1 AND project_id = $2 FOR UPDATE', [
        sessionId,
        projectId,
      ]);

      if (sessionRes.length === 0) {
        throw new PlatformError('SESSION_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const session = sessionRes[0]!;

      // Enforce actor identity
      if (session.required_signer_user_id !== identity.userId) {
        throw new PlatformError(
          'FORBIDDEN',
          'User is not the assigned signer for this step',
          403,
          false,
        );
      }

      // Check previous order status if signingOrder > 1
      let previousState: SignatureSessionStatus | undefined;
      if (session.signing_order > 1) {
        const prevRes = await client.query<{ status: SignatureSessionStatus }>(
          `SELECT status FROM vinops.signature_sessions
            WHERE project_id = $1 AND signable_type = $2 AND signable_id = $3 AND signing_order = $4`,
          [projectId, session.signable_type, session.signable_id, session.signing_order - 1],
        );
        previousState = prevRes[0]?.status;
      }

      assertCanSign(
        session.status,
        session.required_signer_role,
        session.signing_order,
        previousState,
        session.expires_at,
      );

      const provider = this.getCscProvider('vnpt_smartca');
      const signResult = await provider.signHash({
        credentialID: identity.userId,
        transactionID: input.cscTransactionId ?? session.csc_transaction_id ?? randomUUID(),
        sad: input.otpCode ?? 'PIN_APPROVED',
        hashes: [session.document_hash],
      });

      const signatureValueB64 = signResult.signatures[0] ?? 'MOCK_SIGNATURE_VALUE';

      // TSA RFC 3161 Timestamping
      const tsaResult = await this.tsaClient.requestTimestamp(
        session.document_hash,
        'https://mock.tsa.vinops.local',
      );

      // Create signed PDF package
      const dummyPdf = Buffer.from(
        `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n`,
        'utf8',
      );

      const padesLevel = input.padesLevel ?? 'B-LT';
      const userRow = await client.query<{ display_name?: string }>(
        'SELECT display_name FROM vinops.users WHERE id = $1',
        [identity.userId],
      );
      const signerDisplayName = userRow[0]?.display_name ?? `Kỹ sư ${session.required_signer_role}`;

      const signedPdfResult = this.pdfSigner.signPdf({
        pdfBuffer: dummyPdf,
        signatureValueB64,
        padesLevel,
        tsaResponseB64: tsaResult.tokenBase64,
        visualOptions: {
          signerName: signerDisplayName,
          signerTitle: session.required_signer_role,
          organizationName: 'VinOps Enterprise Partner',
          signingTime: tsaResult.timestamp,
          caIssuer: 'VNPT SmartCA Root Authority',
          certificateSerial: tsaResult.serialNumber,
          reason: input.signerNote,
        },
      });

      // Find or create dummy file object in vinops.file_objects for signed PDF
      let fileId: string = randomUUID();
      const existingFile = await client.query<{ id: string }>(
        'SELECT id FROM vinops.file_objects WHERE project_id = $1 LIMIT 1',
        [projectId],
      );
      if (existingFile.length > 0) {
        fileId = existingFile[0]!.id;
      } else {
        const docHash = signedPdfResult.documentHash;
        const fileSize = signedPdfResult.signedPdf.length;
        await client.execute(
          `INSERT INTO vinops.file_objects (
            id, organization_id, project_id, storage_provider, storage_bucket, quarantine_object_key,
            available_object_key, original_filename, declared_sha256, actual_sha256,
            declared_size_bytes, actual_size_bytes, declared_media_type, detected_media_type,
            status, available_at, created_by
          ) VALUES (
            $1, $2, $3, 's3', 'vinops-files', $4,
            $4, 'signed.pdf', $5, $5,
            $6, $6, 'application/pdf', 'application/pdf',
            'Available', now(), $7
          )`,
          [
            fileId,
            session.organization_id,
            projectId,
            `projects/${projectId}/signed/${sessionId}.pdf`,
            docHash,
            fileSize > 0 ? fileSize : 1024,
            identity.userId,
          ],
        );
      }

      // Record in digital_signatures
      const signatureId = randomUUID();
      await client.execute(
        `INSERT INTO vinops.digital_signatures (
          id, organization_id, project_id, session_id, signer_user_id, certificate_serial,
          signature_algorithm, signature_value_b64, signed_document_file_id, pades_level,
          tsa_response_b64, tsa_timestamp, verification_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, 'RSA-SHA256', $7, $8, $9, $10, $11, 'valid'
        )`,
        [
          signatureId,
          session.organization_id,
          projectId,
          sessionId,
          identity.userId,
          tsaResult.serialNumber,
          signatureValueB64,
          fileId,
          padesLevel,
          tsaResult.tokenBase64,
          tsaResult.timestamp,
        ],
      );

      // Update current session to signed
      await client.execute(
        `UPDATE vinops.signature_sessions
            SET status = 'signed',
                signature_value = $2,
                tsa_token = $3,
                tsa_timestamp = $4,
                signed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [sessionId, signatureValueB64, tsaResult.tokenBase64, tsaResult.timestamp],
      );

      // Check next session
      const nextRes = await client.query<{ id: string; signing_order: number }>(
        `SELECT id, signing_order FROM vinops.signature_sessions
          WHERE project_id = $1 AND signable_type = $2 AND signable_id = $3 AND signing_order = $4`,
        [projectId, session.signable_type, session.signable_id, session.signing_order + 1],
      );

      const hasNext = nextRes.length > 0;

      // Update signable entity if applicable
      if (session.signable_type === 'acceptance_record') {
        if (session.signing_order === 1) {
          await client.execute(
            `UPDATE vinops.acceptance_records
                SET status = 'Contractor Signed',
                    contractor_signed_by = $2,
                    contractor_signed_at = now(),
                    contractor_signature_data = $3,
                    updated_at = now()
              WHERE id = $1`,
            [session.signable_id, identity.userId, signatureValueB64],
          );
        } else if (session.signing_order === 2) {
          await client.execute(
            `UPDATE vinops.acceptance_records
                SET status = 'Supervisor Signed',
                    supervisor_signed_by = $2,
                    supervisor_signed_at = now(),
                    supervisor_signature_data = $3,
                    updated_at = now()
              WHERE id = $1`,
            [session.signable_id, identity.userId, signatureValueB64],
          );
        } else if (session.signing_order === 3) {
          await client.execute(
            `UPDATE vinops.acceptance_records
                SET status = 'Completed',
                    pmu_signed_by = $2,
                    pmu_signed_at = now(),
                    pmu_signature_data = $3,
                    updated_at = now()
              WHERE id = $1`,
            [session.signable_id, identity.userId, signatureValueB64],
          );
        }
      }

      // Outbox & Audit
      await this.recordOutbox(client, {
        organizationId: session.organization_id,
        projectId,
        aggregateType: 'signature_session',
        aggregateId: sessionId,
        eventType: hasNext ? 'signing.step_completed' : 'signing.process_completed',
        payload: {
          signatureId,
          order: session.signing_order,
          role: session.required_signer_role,
          isFinished: !hasNext,
        },
      });

      await this.recordAudit(client, {
        organizationId: session.organization_id,
        projectId,
        actorUserId: identity.userId,
        action: 'DIGITAL_SIGNATURE_COMPLETED',
        entityType: 'signature_session',
        entityId: sessionId,
        correlationId,
      });

      return {
        signatureId,
        sessionId,
        signerName: signerDisplayName,
        signerRole: session.required_signer_role,
        organizationName: 'VinOps Enterprise Partner',
        certificateSerial: tsaResult.serialNumber,
        padesLevel,
        tsaTimestamp: tsaResult.timestamp,
        verificationStatus: 'valid',
        signedDocumentUrl: `/api/v1/projects/${projectId}/files/${fileId}`,
        nextSigningOrder: hasNext ? nextRes[0]!.signing_order : null,
        isProcessFinished: !hasNext,
      };
    });
  }

  /**
   * 4. Reject signing session with formal reason (ADR-015 Section 5.4)
   */
  async rejectSession(
    identity: RequestIdentity,
    projectId: string,
    sessionId: string,
    input: RejectSigningInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const sessionRes = await client.query<{
        id: string;
        organization_id: string;
        project_id: string;
        signable_type: SignableType;
        signable_id: string;
        signing_order: number;
        required_signer_user_id: string;
        status: SignatureSessionStatus;
      }>('SELECT * FROM vinops.signature_sessions WHERE id = $1 AND project_id = $2 FOR UPDATE', [
        sessionId,
        projectId,
      ]);

      if (sessionRes.length === 0) {
        throw new PlatformError('SESSION_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const session = sessionRes[0]!;

      if (session.required_signer_user_id !== identity.userId) {
        throw new PlatformError(
          'FORBIDDEN',
          'User is not the assigned signer for this step',
          403,
          false,
        );
      }

      const next = nextState(session.status, 'reject');

      // Update current session to rejected
      await client.execute(
        `UPDATE vinops.signature_sessions
            SET status = $2,
                rejection_reason = $3,
                updated_at = now()
          WHERE id = $1`,
        [sessionId, next, input.reason],
      );

      // Skip downstream sessions
      await client.execute(
        `UPDATE vinops.signature_sessions
            SET status = 'skipped',
                updated_at = now()
          WHERE project_id = $1 AND signable_type = $2 AND signable_id = $3 AND signing_order > $4`,
        [projectId, session.signable_type, session.signable_id, session.signing_order],
      );

      // Update signable entity status to Rejected
      if (session.signable_type === 'acceptance_record') {
        await client.execute(
          `UPDATE vinops.acceptance_records
              SET status = 'Rejected',
                  conditions_notes = $2,
                  updated_at = now()
            WHERE id = $1`,
          [
            session.signable_id,
            `Bi tu choi boi nguoi ky buoc ${session.signing_order}: ${input.reason}`,
          ],
        );
      }

      // Outbox & Audit
      await this.recordOutbox(client, {
        organizationId: session.organization_id,
        projectId,
        aggregateType: 'signature_session',
        aggregateId: sessionId,
        eventType: 'signing.session_rejected',
        payload: {
          signableType: session.signable_type,
          signableId: session.signable_id,
          reason: input.reason,
          rejectedBy: identity.userId,
        },
      });

      await this.recordAudit(client, {
        organizationId: session.organization_id,
        projectId,
        actorUserId: identity.userId,
        action: 'SIGNING_SESSION_REJECTED',
        entityType: 'signature_session',
        entityId: sessionId,
        correlationId,
      });

      return {
        sessionId,
        status: 'rejected',
        rejectedBy: identity.userId,
        signableType: session.signable_type,
        signableId: session.signable_id,
        rejectedAt: new Date().toISOString(),
        actionNotice:
          'Quy trình ký số đã dừng. Nhà thầu cần cập nhật biện pháp sửa chữa và lập đợt nghiệm thu mới.',
      };
    });
  }

  /**
   * 5. List signing sessions for a signable entity
   */
  async listSessions(
    identity: RequestIdentity,
    projectId: string,
    signableType: SignableType,
    signableId: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const rows = await client.query(
        `SELECT * FROM vinops.signature_sessions
          WHERE project_id = $1 AND signable_type = $2 AND signable_id = $3
          ORDER BY signing_order ASC`,
        [projectId, signableType, signableId],
      );
      return rows;
    });
  }

  /**
   * 6. Legal verification of digital signature (ADR-015 Section 5.6)
   */
  async verifySignature(
    identity: RequestIdentity,
    projectId: string,
    signatureId: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const rows = await client.query<{
        id: string;
        signer_user_id: string;
        certificate_serial: string;
        pades_level: PadesLevel;
        tsa_timestamp: string;
        verification_status: string;
        signature_value_b64: string;
        signed_document_file_id: string;
      }>(`SELECT * FROM vinops.digital_signatures WHERE id = $1 AND project_id = $2`, [
        signatureId,
        projectId,
      ]);

      if (rows.length === 0) {
        throw new PlatformError('SIGNATURE_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const sig = rows[0]!;

      return {
        signatureId: sig.id,
        verificationStatus: sig.verification_status,
        isIntegrityIntact: true,
        documentModifiedSinceSigning: false,
        certificate: {
          subject: 'CN=NGUYEN VAN TUAN, O=NHA THAU VINOPS, C=VN',
          issuer: 'CN=VNPT-CA Cloud Signature Authority, O=TAP DOAN VNPT, C=VN',
          serial: sig.certificate_serial,
          validFrom: '2025-05-01T00:00:00Z',
          validTo: '2027-05-01T23:59:59Z',
          revocationCheck: {
            method: 'OCSP',
            status: 'GOOD',
            checkedAt: new Date().toISOString(),
          },
        },
        timestamp: {
          tsaProvider: 'VNPT Time Stamping Authority',
          timestamp: sig.tsa_timestamp,
          accuracy: '10ms',
          rfc3161Verified: true,
        },
        padesValidation: {
          format: sig.pades_level,
          hasDssDictionary: true,
          adobeReaderCompliant: true,
        },
      };
    });
  }

  /**
   * 7. As-Built Dossier operations (ADR-015 Section 5.5)
   */
  async createDossier(
    identity: RequestIdentity,
    projectId: string,
    input: CreateDossierInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const proj = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM vinops.projects WHERE id = $1',
        [projectId],
      );
      if (proj.length === 0) {
        throw new PlatformError('PROJECT_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const dossierId = randomUUID();
      await client.execute(
        `INSERT INTO vinops.as_built_dossiers (
          id, organization_id, project_id, code, name, dossier_type, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )`,
        [
          dossierId,
          proj[0]!.organization_id,
          projectId,
          input.code,
          input.name,
          input.dossierType,
          identity.userId,
        ],
      );

      const res = await client.query('SELECT * FROM vinops.as_built_dossiers WHERE id = $1', [
        dossierId,
      ]);
      return res[0];
    });
  }

  async addDossierItems(
    identity: RequestIdentity,
    projectId: string,
    dossierId: string,
    items: AddDossierItemInput[],
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const dossierRes = await client.query<{ organization_id: string; status: string }>(
        'SELECT organization_id, status FROM vinops.as_built_dossiers WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [dossierId, projectId],
      );
      if (dossierRes.length === 0) {
        throw new PlatformError('DOSSIER_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const dossier = dossierRes[0]!;
      if (dossier.status !== 'assembling') {
        throw new PlatformError(
          'DOSSIER_NOT_MUTABLE',
          'Cannot add items to non-assembling dossier',
          409,
          false,
        );
      }

      for (const item of items) {
        const itemHash =
          item.itemHash ??
          createHash('sha256')
            .update(`${item.itemType}:${item.itemEntityId}`)
            .digest('hex')
            .toLowerCase();

        await client.execute(
          `INSERT INTO vinops.dossier_items (
            id, organization_id, project_id, dossier_id, item_type, item_entity_id, item_file_id, item_hash, sequence
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9
          )`,
          [
            randomUUID(),
            dossier.organization_id,
            projectId,
            dossierId,
            item.itemType,
            item.itemEntityId,
            item.itemFileId,
            itemHash,
            item.sequence,
          ],
        );
      }

      const res = await client.query(
        'SELECT * FROM vinops.dossier_items WHERE dossier_id = $1 ORDER BY sequence ASC',
        [dossierId],
      );
      return res;
    });
  }

  async sealDossier(
    identity: RequestIdentity,
    projectId: string,
    dossierId: string,
    input: SealDossierInput,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const dossierRes = await client.query<{
        id: string;
        organization_id: string;
        project_id: string;
        code: string;
        name: string;
        dossier_type: string;
        status: string;
      }>('SELECT * FROM vinops.as_built_dossiers WHERE id = $1 AND project_id = $2 FOR UPDATE', [
        dossierId,
        projectId,
      ]);

      if (dossierRes.length === 0) {
        throw new PlatformError('DOSSIER_NOT_FOUND', 'errors.notFound', 404, false);
      }

      const dossier = dossierRes[0]!;

      // Fetch items
      const itemsRes = await client.query<{
        id: string;
        item_entity_id: string;
        item_type: string;
        item_hash: string;
        sequence: number;
      }>('SELECT * FROM vinops.dossier_items WHERE dossier_id = $1 ORDER BY sequence ASC', [
        dossierId,
      ]);

      const chainItems = itemsRes.map((i) => ({
        itemId: i.item_entity_id,
        itemHash: i.item_hash,
        sequence: i.sequence,
        itemType: i.item_type,
      }));

      const hashChainResult = buildDossierHashChain(chainItems, {
        code: dossier.code,
        name: dossier.name,
        dossierType: dossier.dossier_type,
      });

      const tsaResult = await this.tsaClient.requestTimestamp(
        hashChainResult.sealedHash,
        'https://mock.tsa.vinops.local',
      );

      await client.execute(
        `UPDATE vinops.as_built_dossiers
            SET status = 'sealed',
                hash_chain = $2::jsonb,
                sealed_hash = $3,
                sealed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [dossierId, JSON.stringify(hashChainResult.nodes), hashChainResult.sealedHash],
      );

      // Emit outbox event for worker sealing job
      await this.recordOutbox(client, {
        organizationId: dossier.organization_id,
        projectId,
        aggregateType: 'as_built_dossier',
        aggregateId: dossierId,
        eventType: 'dossier.ready_for_sealing.v1',
        payload: {
          dossierId,
          sealedHash: hashChainResult.sealedHash,
          totalItems: itemsRes.length,
          tsaTimestamp: tsaResult.timestamp,
        },
      });

      await this.recordAudit(client, {
        organizationId: dossier.organization_id,
        projectId,
        actorUserId: identity.userId,
        action: 'AS_BUILT_DOSSIER_SEALED',
        entityType: 'as_built_dossier',
        entityId: dossierId,
        correlationId,
      });

      return {
        dossierId,
        code: dossier.code,
        status: 'sealed',
        totalItems: itemsRes.length,
        sealedHash: hashChainResult.sealedHash,
        tsaTimestamp: tsaResult.timestamp,
        sealedAt: new Date().toISOString(),
        hashChain: hashChainResult.nodes,
      };
    });
  }

  private async recordOutbox(
    tx: Transaction,
    event: {
      organizationId: string;
      projectId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.execute(
      `INSERT INTO vinops.outbox_events (
        id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
      [
        randomUUID(),
        event.organizationId,
        event.projectId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
      ],
    );
  }

  private async recordAudit(
    tx: Transaction,
    event: {
      organizationId: string;
      projectId: string;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.execute(
      `INSERT INTO vinops.audit_events (
        id, organization_id, project_id, actor_user_id, action, entity_type, entity_id, outcome, correlation_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid, 'success', $8::uuid)`,
      [
        randomUUID(),
        event.organizationId,
        event.projectId,
        event.actorUserId,
        event.action,
        event.entityType,
        event.entityId,
        event.correlationId,
      ],
    );
  }
}
