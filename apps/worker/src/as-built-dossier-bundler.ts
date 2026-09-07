import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Logger } from 'pino';
import type { VinopsDatabase } from '@vinops/database';
import { ND207_LEGAL_BASIS } from '@vinops/domain';

export type DossierFileEntry = {
  name: string;
  content: Buffer | string;
};

export type DossierManifest = {
  dossier_id: string;
  project_id: string;
  contract_package_id?: string;
  generated_at: string;
  legal_basis: string;
  summary: {
    acceptance_records_count: number;
    inspections_count: number;
    findings_count: number;
    daily_logs_count: number;
  };
  files: Array<{
    path: string;
    size_bytes: number;
    sha256: string;
  }>;
};

export type BundledDossierResult = {
  dossierId: string;
  zipBuffer: Buffer;
  sha256: string;
  manifest: DossierManifest;
};

/**
 * Builds a deterministic, standard PKZIP archive buffer in pure Node.js.
 */
export function buildZipArchive(files: readonly DossierFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const dataBuf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    const checksum = crc32(dataBuf);

    // Local file header (30 bytes + name)
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0); // Local header signature
    lh.writeUInt16LE(20, 4); // Version needed
    lh.writeUInt16LE(0, 6); // Bit flag
    lh.writeUInt16LE(0, 8); // Compression (0 = Store)
    lh.writeUInt16LE(0, 10); // Mod time
    lh.writeUInt16LE(0, 12); // Mod date
    lh.writeUInt32LE(checksum, 14); // CRC-32
    lh.writeUInt32LE(dataBuf.length, 18); // Compressed size
    lh.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26); // Filename length
    lh.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(lh, 30);

    // Central directory header (46 bytes + name)
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); // CD signature
    cd.writeUInt16LE(20, 4); // Version made by
    cd.writeUInt16LE(20, 6); // Version needed
    cd.writeUInt16LE(0, 8); // Bit flag
    cd.writeUInt16LE(0, 10); // Compression (0 = Store)
    cd.writeUInt16LE(0, 12); // Mod time
    cd.writeUInt16LE(0, 14); // Mod date
    cd.writeUInt32LE(checksum, 16); // CRC-32
    cd.writeUInt32LE(dataBuf.length, 20); // Compressed size
    cd.writeUInt32LE(dataBuf.length, 24); // Uncompressed size
    cd.writeUInt16LE(nameBuf.length, 28); // Filename length
    cd.writeUInt16LE(0, 30); // Extra field length
    cd.writeUInt16LE(0, 32); // Comment length
    cd.writeUInt16LE(0, 34); // Disk start
    cd.writeUInt16LE(0, 36); // Internal attrs
    cd.writeUInt32LE(0, 38); // External attrs
    cd.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuf.copy(cd, 46);

    localHeaders.push(lh, dataBuf);
    cdHeaders.push(cd);
    offset += lh.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(cdHeaders);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with CD
  eocd.writeUInt16LE(files.length, 8); // CD entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total CD entries
  eocd.writeUInt32LE(cdBuf.length, 12); // Size of CD
  eocd.writeUInt32LE(offset, 16); // CD start offset
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

export class AsBuiltDossierBundler {
  constructor(
    private readonly database: VinopsDatabase,
    private readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>,
    private readonly systemUserId: string = '00000000-0000-0000-0000-000000000000',
  ) {}

  async bundleDossier(
    projectId: string,
    options?: { contractPackageId?: string },
  ): Promise<BundledDossierResult> {
    const dossierId = randomUUID();
    const generatedAt = new Date().toISOString();

    const { acceptanceRecords, inspections, findings, dailyLogs } =
      await this.database.withTransaction({ actorUserId: this.systemUserId }, async (client) => {
        const acceptanceRecords = await client.query(
          `SELECT * FROM vinops.acceptance_records
            WHERE project_id = $1
            ORDER BY recorded_at DESC`,
          [projectId],
        );

        const inspections = await client.query(
          `SELECT i.*,
                  COALESCE((SELECT json_agg(r) FROM vinops.inspection_results r WHERE r.inspection_id = i.id), '[]') AS results
             FROM vinops.inspections i
            WHERE i.project_id = $1
            ORDER BY i.inspection_date DESC`,
          [projectId],
        );

        const findings = await client.query(
          `SELECT f.*,
                  COALESCE((SELECT json_agg(c ORDER BY c.attempt_no) FROM vinops.corrective_actions c WHERE c.finding_id = f.id), '[]') AS corrective_actions
             FROM vinops.inspection_findings f
            WHERE f.project_id = $1
            ORDER BY f.created_at DESC`,
          [projectId],
        );

        const dailyLogs = await client.query(
          `SELECT l.*,
                  COALESCE((SELECT json_agg(m) FROM vinops.daily_manpower m WHERE m.daily_log_id = l.id), '[]') AS manpower,
                  COALESCE((SELECT json_agg(e) FROM vinops.daily_equipment e WHERE e.daily_log_id = l.id), '[]') AS equipment,
                  COALESCE((SELECT json_agg(w ORDER BY w.time_of_day) FROM vinops.daily_weather w WHERE w.daily_log_id = l.id), '[]') AS weather
             FROM vinops.daily_logs l
            WHERE l.project_id = $1
            ORDER BY l.log_date DESC`,
          [projectId],
        );

        return { acceptanceRecords, inspections, findings, dailyLogs };
      });

    const filesToZip: DossierFileEntry[] = [];

    // 1. Acceptance records file
    const acceptanceContent = JSON.stringify(acceptanceRecords, null, 2);
    filesToZip.push({ name: 'acceptance/acceptance_records.json', content: acceptanceContent });

    // 2. Inspections file
    const inspectionsContent = JSON.stringify(inspections, null, 2);
    filesToZip.push({ name: 'inspections/inspections.json', content: inspectionsContent });

    // 3. Findings & CAR file
    const findingsContent = JSON.stringify(findings, null, 2);
    filesToZip.push({ name: 'findings/findings_and_cars.json', content: findingsContent });

    // 4. Daily Logs file
    const dailyLogsContent = JSON.stringify(dailyLogs, null, 2);
    filesToZip.push({ name: 'daily_logs/daily_logs.json', content: dailyLogsContent });

    // 5. Summary Markdown report
    const summaryMd = [
      `# HỒ SƠ HOÀN CÔNG & NGHIỆM THU CHẤT LƯỢNG CÔNG TRÌNH`,
      `**Căn cứ pháp lý:** ${ND207_LEGAL_BASIS}`,
      `**Dự án ID:** ${projectId}`,
      options?.contractPackageId ? `**Gói thầu ID:** ${options.contractPackageId}` : '',
      `**Thời gian xuất hồ sơ:** ${generatedAt}`,
      `**Mã hồ sơ hoàn công:** ${dossierId}`,
      ``,
      `## 1. Biên bản nghiệm thu (3 bên theo NĐ 207/2026/NĐ-CP)`,
      `- Tổng số biên bản: ${acceptanceRecords.length}`,
      ``,
      `## 2. Phiếu kiểm tra hiện trường & Checklist`,
      `- Tổng số phiếu nghiệm thu: ${inspections.length}`,
      ``,
      `## 3. Khuyết tật & Yêu cầu khắc phục (CAR)`,
      `- Tổng số điểm không phù hợp: ${findings.length}`,
      ``,
      `## 4. Nhật ký thi công điện tử`,
      `- Tổng số nhật ký xác nhận: ${dailyLogs.length}`,
    ]
      .filter(Boolean)
      .join('\n');
    filesToZip.push({ name: 'README_DOSSIER.md', content: summaryMd });

    // 6. Manifest file
    const manifestFiles = filesToZip.map((f) => {
      const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
      const sha = createHash('sha256').update(buf).digest('hex');
      return {
        path: f.name,
        size_bytes: buf.length,
        sha256: sha,
      };
    });

    const manifest: DossierManifest = {
      dossier_id: dossierId,
      project_id: projectId,
      ...(options?.contractPackageId ? { contract_package_id: options.contractPackageId } : {}),
      generated_at: generatedAt,
      legal_basis: ND207_LEGAL_BASIS,
      summary: {
        acceptance_records_count: acceptanceRecords.length,
        inspections_count: inspections.length,
        findings_count: findings.length,
        daily_logs_count: dailyLogs.length,
      },
      files: manifestFiles,
    };

    const manifestContent = JSON.stringify(manifest, null, 2);
    filesToZip.unshift({ name: 'manifest.json', content: manifestContent });

    // Build ZIP
    const zipBuffer = buildZipArchive(filesToZip);
    const sha256 = createHash('sha256').update(zipBuffer).digest('hex');

    this.logger.info(
      {
        dossier_id: dossierId,
        zip_bytes: zipBuffer.length,
        sha256,
        items_count: filesToZip.length,
      },
      'as-built dossier bundle created',
    );

    return {
      dossierId,
      zipBuffer,
      sha256,
      manifest,
    };
  }
}
