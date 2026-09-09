import { Pool } from '../packages/database/dist/index.js';

const host = process.env.PGHOST ?? '127.0.0.1';
const port = process.env.PGPORT ?? '5432';
const user = process.env.PGUSER ?? 'postgres';
const pass = process.env.PGPASSWORD ?? 'postgres';
const db = process.env.PGDATABASE ?? 'vinops';
const connectionString =
  process.env.VINOPS_DATABASE_URL ?? `postgresql://${user}:${pass}@${host}:${port}/${db}`;

const pool = new Pool({ connectionString, max: 1 });

const ids = {
  owner: '00000000-0000-4000-8000-000000000101',
  member: '00000000-0000-4000-8000-000000000102',
  reviewer: '00000000-0000-4000-8000-000000000103',
  publisher: '00000000-0000-4000-8000-000000000104',
  organization: '00000000-0000-4000-8000-000000000201',
  project: '00000000-0000-4000-8000-000000000301',
  contractPackage: '00000000-0000-4000-8000-000000005001',

  // Partner organizations
  contractorOrg: '00000000-0000-4000-8000-000000001001',
  consultantOrg: '00000000-0000-4000-8000-000000001002',
  mepOrg: '00000000-0000-4000-8000-000000001003',

  // Locations (LBS)
  locTowerA: '00000000-0000-4000-8000-000000002001',
  locTowerAB1: '00000000-0000-4000-8000-000000002002',
  locTowerAF1: '00000000-0000-4000-8000-000000002003',
  locTowerAF2: '00000000-0000-4000-8000-000000002004',
  locTowerARoof: '00000000-0000-4000-8000-000000002005',
  locPodium: '00000000-0000-4000-8000-000000002006',

  // Work Nodes (WBS)
  wbsStr: '00000000-0000-4000-8000-000000003001',
  wbsStrSub: '00000000-0000-4000-8000-000000003002',
  wbsStrSuper: '00000000-0000-4000-8000-000000003003',
  wbsArc: '00000000-0000-4000-8000-000000003004',
  wbsMep: '00000000-0000-4000-8000-000000003005',

  // Disciplines
  discStr: '00000000-0000-4000-8000-000000004001',
  discArc: '00000000-0000-4000-8000-000000004002',
  discMep: '00000000-0000-4000-8000-000000004003',

  // Classifications
  classDwg: '00000000-0000-4000-8000-000000004101',
  classSpec: '00000000-0000-4000-8000-000000004102',
  classMethod: '00000000-0000-4000-8000-000000004103',

  // Documents
  doc1: '00000000-0000-4000-8000-000000005101',
  doc2: '00000000-0000-4000-8000-000000005102',
  doc3: '00000000-0000-4000-8000-000000005103',
  doc4: '00000000-0000-4000-8000-000000005104',

  // Revisions
  rev1: '00000000-0000-4000-8000-000000005201',
  rev2: '00000000-0000-4000-8000-000000005202',
  rev3: '00000000-0000-4000-8000-000000005203',
  rev4: '00000000-0000-4000-8000-000000005204',

  // Inspection Templates
  tplRebar: '00000000-0000-4000-8000-000000006001',
  tplConcrete: '00000000-0000-4000-8000-000000006002',
  tplFire: '00000000-0000-4000-8000-000000006003',

  // Inspections
  insp1: '00000000-0000-4000-8000-000000006101',
  insp2: '00000000-0000-4000-8000-000000006102',
  insp3: '00000000-0000-4000-8000-000000006103',

  // Daily logs
  log1: '00000000-0000-4000-8000-000000007001',
  log2: '00000000-0000-4000-8000-000000007002',
  log3: '00000000-0000-4000-8000-000000007003',
};

async function seed() {
  console.log('Seeding realistic operational data for VinOps...');

  // 1. Partner Organizations
  await pool.query(`
    INSERT INTO vinops.partner_organizations (id, organization_id, project_id, code, name, status, created_by)
    VALUES
      ('${ids.contractorOrg}', '${ids.organization}', '${ids.project}', 'CONT-VINACONS', 'Tổng Công ty Xây lắp Vinacons (Tổng thầu EPC)', 'Active', '${ids.owner}'),
      ('${ids.consultantOrg}', '${ids.organization}', '${ids.project}', 'CONS-APAVE', 'Công ty Tư vấn Giám sát Apave Châu Á', 'Active', '${ids.owner}'),
      ('${ids.mepOrg}', '${ids.organization}', '${ids.project}', 'SUB-REEMEP', 'Công ty CP Cơ điện & PCCC Ree M&E', 'Active', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Link project members to partner orgs
  await pool.query(`
    UPDATE vinops.project_members
    SET partner_organization_id = '${ids.contractorOrg}'
    WHERE user_id = '${ids.member}' AND project_id = '${ids.project}';

    UPDATE vinops.project_members
    SET partner_organization_id = '${ids.consultantOrg}'
    WHERE user_id = '${ids.reviewer}' AND project_id = '${ids.project}';
  `);

  // 2. Location Nodes (LBS)
  await pool.query(`
    INSERT INTO vinops.location_nodes (id, organization_id, project_id, code, name, node_type, sort_order, created_by)
    VALUES
      ('${ids.locTowerA}', '${ids.organization}', '${ids.project}', 'TOWER-A', 'Tháp A - Khu Căn hộ Cao cấp', 'building', 1, '${ids.owner}'),
      ('${ids.locPodium}', '${ids.organization}', '${ids.project}', 'PODIUM', 'Khối đế Thương mại & Cảnh quan', 'podium', 2, '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.location_nodes (id, organization_id, project_id, parent_id, code, name, node_type, sort_order, created_by)
    VALUES
      ('${ids.locTowerAB1}', '${ids.organization}', '${ids.project}', '${ids.locTowerA}', 'B1', 'Tầng hầm B1 (Kỹ thuật & Đỗ xe)', 'floor', 1, '${ids.owner}'),
      ('${ids.locTowerAF1}', '${ids.organization}', '${ids.project}', '${ids.locTowerA}', 'F01', 'Tầng 1 (Sảnh chính & Shophouse)', 'floor', 2, '${ids.owner}'),
      ('${ids.locTowerAF2}', '${ids.organization}', '${ids.project}', '${ids.locTowerA}', 'F02', 'Tầng 2 (Khu tiện ích & Bể bơi)', 'floor', 3, '${ids.owner}'),
      ('${ids.locTowerARoof}', '${ids.organization}', '${ids.project}', '${ids.locTowerA}', 'ROOF', 'Tầng mái & Tum kỹ thuật thang máy', 'roof', 4, '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 3. Work Nodes (WBS)
  await pool.query(`
    INSERT INTO vinops.work_nodes (id, organization_id, project_id, code, name, node_type, status, created_by)
    VALUES
      ('${ids.wbsStr}', '${ids.organization}', '${ids.project}', 'STR', 'Công tác Kết cấu bê tông cốt thép', 'discipline', 'Active', '${ids.owner}'),
      ('${ids.wbsArc}', '${ids.organization}', '${ids.project}', 'ARC', 'Công tác Kiến trúc & Hoàn thiện', 'discipline', 'Active', '${ids.owner}'),
      ('${ids.wbsMep}', '${ids.organization}', '${ids.project}', 'MEP', 'Công tác Cơ điện & PCCC', 'discipline', 'Active', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.work_nodes (id, organization_id, project_id, parent_id, code, name, node_type, status, created_by)
    VALUES
      ('${ids.wbsStrSub}', '${ids.organization}', '${ids.project}', '${ids.wbsStr}', 'STR-SUB', 'Kết cấu phần ngầm & Móng cọc', 'work_package', 'Active', '${ids.owner}'),
      ('${ids.wbsStrSuper}', '${ids.organization}', '${ids.project}', '${ids.wbsStr}', 'STR-SUPER', 'Kết cấu phần thân (Cột, Dầm, Sàn)', 'work_package', 'Active', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 4. Disciplines
  await pool.query(`
    INSERT INTO vinops.disciplines (id, organization_id, project_id, code, name, created_by)
    VALUES
      ('${ids.discStr}', '${ids.organization}', '${ids.project}', 'STR', 'Kết cấu (Structural)', '${ids.owner}'),
      ('${ids.discArc}', '${ids.organization}', '${ids.project}', 'ARC', 'Kiến trúc (Architectural)', '${ids.owner}'),
      ('${ids.discMep}', '${ids.organization}', '${ids.project}', 'MEP', 'Cơ điện (MEP Engineering)', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 5. Document Classifications
  await pool.query(`
    INSERT INTO vinops.document_classifications (id, organization_id, project_id, classification_type, code, name, created_by)
    VALUES
      ('${ids.classDwg}', '${ids.organization}', '${ids.project}', 'document_type', 'DWG', 'Bản vẽ thi công (Shop Drawings)', '${ids.owner}'),
      ('${ids.classSpec}', '${ids.organization}', '${ids.project}', 'document_type', 'SPEC', 'Chỉ dẫn kỹ thuật (Specifications)', '${ids.owner}'),
      ('${ids.classMethod}', '${ids.organization}', '${ids.project}', 'document_type', 'METHOD', 'Biện pháp thi công (Method Statement)', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 6. Documents & Document Revisions
  await pool.query(`
    INSERT INTO vinops.documents (id, organization_id, project_id, numbering_context, code, title, document_type, discipline_id, classification_id, created_by)
    VALUES
      ('${ids.doc1}', '${ids.organization}', '${ids.project}', 'default', 'SYN-DWG-STR-F02-01', 'Bản vẽ chi tiết bố trí cốt thép dầm sàn Tầng 2 Tháp A', 'drawing', '${ids.discStr}', '${ids.classDwg}', '${ids.owner}'),
      ('${ids.doc2}', '${ids.organization}', '${ids.project}', 'default', 'SYN-DWG-ARC-F01-01', 'Mặt bằng bố trí kiến trúc Tầng 1 sảnh chính & thương mại', 'drawing', '${ids.discArc}', '${ids.classDwg}', '${ids.owner}'),
      ('${ids.doc3}', '${ids.organization}', '${ids.project}', 'default', 'SYN-SPEC-MEP-HVAC-01', 'Quy cách kỹ thuật & nghiệm thu hệ thống thông gió HVAC', 'specification', '${ids.discMep}', '${ids.classSpec}', '${ids.owner}'),
      ('${ids.doc4}', '${ids.organization}', '${ids.project}', 'default', 'SYN-METH-STR-B1-01', 'Biện pháp thi công đào đất & hạ mực nước ngầm tầng hầm B1', 'method_statement', '${ids.discStr}', '${ids.classMethod}', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.document_revisions (id, organization_id, project_id, document_id, revision_code, purpose, status, created_by)
    VALUES
      ('${ids.rev1}', '${ids.organization}', '${ids.project}', '${ids.doc1}', 'Rev-A', 'Bản vẽ phát hành thi công chính thức', 'Approved', '${ids.owner}'),
      ('${ids.rev2}', '${ids.organization}', '${ids.project}', '${ids.doc2}', 'Rev-01', 'Phát hành để phê duyệt chủ đầu tư', 'Published', '${ids.owner}'),
      ('${ids.rev3}', '${ids.organization}', '${ids.project}', '${ids.doc3}', 'Rev-0', 'Trình duyệt chỉ dẫn kỹ thuật thiết bị', 'Under Review', '${ids.owner}'),
      ('${ids.rev4}', '${ids.organization}', '${ids.project}', '${ids.doc4}', 'Rev-B', 'Biện pháp thi công đã duyệt sau hiệu chỉnh', 'Approved', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 7. Field Issues (Kanban Board)
  await pool.query(`
    INSERT INTO vinops.field_issues (
      id, organization_id, project_id, code, title, description, category, severity, status,
      location_node_id, work_node_id, contractor_organization_id, assigned_to_user_id,
      gps_latitude, gps_longitude, created_by, created_at, updated_at
    ) VALUES
      ('00000000-0000-4000-8000-000000010001', '${ids.organization}', '${ids.project}', 'ISS-001',
       'Nứt bề mặt dầm bê tông D2 trục 3-C tầng 1',
       'Phát hiện vết nứt chân chim bề mặt rộng ~0.15mm sau khi tháo dỡ ván khuôn 3 ngày. Yêu cầu kiểm tra đo đạc độ sâu và trám vữa Sika Monotop.',
       'Chất lượng bê tông', 'high', 'Open',
       '${ids.locTowerAF1}', '${ids.wbsStrSuper}', '${ids.contractorOrg}', '${ids.member}',
       10.776889, 106.700897, '${ids.owner}', now() - interval '2 days', now() - interval '2 days'),

      ('00000000-0000-4000-8000-000000010002', '${ids.organization}', '${ids.project}', 'ISS-002',
       'Thiếu lan can an toàn và lưới chắn bụi khu vực thang bộ',
       'Khu vực cầu thang bộ trục 4 tầng 2 chưa lắp đặt lan can tạm 1.1m và tấm chắn chân mép sàn, tiềm ẩn rủi ro té ngã nghiêm trọng.',
       'An toàn lao động', 'critical', 'Under Triage',
       '${ids.locTowerAF2}', '${ids.wbsStrSuper}', '${ids.contractorOrg}', '${ids.member}',
       10.776910, 106.700920, '${ids.reviewer}', now() - interval '1 day', now() - interval '1 day'),

      ('00000000-0000-4000-8000-000000010003', '${ids.organization}', '${ids.project}', 'ISS-003',
       'Thép chờ cột C4 bị sai lệch vị trí 22mm so với tim trục',
       'Thép chờ cột C4 tầng 2 bị xô lệch về phía trục Y. Cần nắn chỉnh bằng biện pháp gia nhiệt uốn 1:6 theo TCVN hoặc khoan cấy Ramset bổ sung.',
       'Cốt thép', 'medium', 'In Progress',
       '${ids.locTowerAF2}', '${ids.wbsStrSuper}', '${ids.contractorOrg}', '${ids.member}',
       10.776850, 106.700880, '${ids.reviewer}', now() - interval '3 days', now() - interval '1 hour'),

      ('00000000-0000-4000-8000-000000010004', '${ids.organization}', '${ids.project}', 'ISS-004',
       'Mối nối ống luồn dây điện âm sàn chưa dán băng keo kín',
       'Các khớp nối ống luồn dây PVC âm sàn tầng 2 chưa dán keo chống nước, bê tông tươi có thể xâm nhập gây nghẹt ống dẫn cáp.',
       'Cơ điện MEP', 'low', 'Resolved',
       '${ids.locTowerAF2}', '${ids.wbsMep}', '${ids.mepOrg}', '${ids.member}',
       10.776860, 106.700910, '${ids.owner}', now() - interval '4 days', now() - interval '12 hours'),

      ('00000000-0000-4000-8000-000000010005', '${ids.organization}', '${ids.project}', 'ISS-005',
       'Cốp pha dầm biên bị phình 15mm sau khi đổ bê tông',
       'Ván khuôn đáy dầm biên trục A bị phình nhẹ do giằng chưa đủ dày. Nhà thầu đã đục tẩy bề mặt và trát phẳng đạt nghiệm thu hoàn tất.',
       'Ván khuôn', 'medium', 'Closed',
       '${ids.locTowerAF1}', '${ids.wbsStrSuper}', '${ids.contractorOrg}', '${ids.member}',
       10.776820, 106.700850, '${ids.owner}', now() - interval '5 days', now() - interval '1 day'),

      ('00000000-0000-4000-8000-000000010006', '${ids.organization}', '${ids.project}', 'ISS-006',
       'Công nhân nhà thầu phụ không cài quai nón bảo hộ',
       'Đội thợ gia công thép có 3 công nhân không thắt quai nón bảo hộ khi làm việc dưới vùng nâng hạ cẩu tháp. Đã lập biên bản nhắc nhở.',
       'An toàn lao động', 'high', 'Assigned',
       '${ids.locTowerAF1}', '${ids.wbsStrSuper}', '${ids.contractorOrg}', '${ids.member}',
       10.776840, 106.700870, '${ids.reviewer}', now() - interval '6 hours', now() - interval '1 hour')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 8. RFIs
  await pool.query(`
    INSERT INTO vinops.rfi_requests (
      id, organization_id, project_id, code, title, question, suggested_solution, status, priority,
      location_node_id, work_node_id, document_id, requesting_partner_organization_id,
      responding_partner_organization_id, ball_in_court_organization_id, sla_business_days,
      created_by, created_at, updated_at
    ) VALUES
      ('00000000-0000-4000-8000-000000020001', '${ids.organization}', '${ids.project}', 'RFI-001',
       'Làm rõ xung đột cao độ dầm D10 và đường ống cấp gió tươi HVAC tầng hầm B1',
       'Tại vị trí trục 3 giao trục C tầng hầm B1, cao độ đáy dầm D10 (cốt -1.80m) giao cắt trực tiếp với tuyến ống gió kích thước 600x400 (cốt đáy -1.75m). Kính đề nghị Tư vấn Thiết kế hướng dẫn xử lý.',
       'Đề xuất giảm chiều cao tiết diện ống gió thành 800x250 hoặc chia thành 2 nhánh ống dẹt 400x250 để lọt qua đáy dầm.',
       'Official Answered', 'high',
       '${ids.locTowerAB1}', '${ids.wbsMep}', '${ids.doc3}', '${ids.contractorOrg}',
       '${ids.consultantOrg}', '${ids.contractorOrg}', 3,
       '${ids.member}', now() - interval '4 days', now() - interval '1 day'),

      ('00000000-0000-4000-8000-000000020002', '${ids.organization}', '${ids.project}', 'RFI-002',
       'Xung đột cốt thép cột C12 và ống thoát nước mưa PVC D110 âm cột',
       'Bản vẽ ME thể hiện ống thoát nước mưa D110 đi âm trong cột C12 (tiết diện 600x600). Tuy nhiên mật độ cốt thép dọc của cột tại tầng 1 rất dày (16D25), không đủ khoảng hở đổ bê tông nếu đặt ống âm.',
       'Đề xuất dời ống thoát nước mưa ra ngoài cạnh cột và bọc hộp gen thạch cao chống cháy.',
       'Under Review', 'urgent',
       '${ids.locTowerAF1}', '${ids.wbsStrSuper}', '${ids.doc1}', '${ids.contractorOrg}',
       '${ids.consultantOrg}', '${ids.consultantOrg}', 2,
       '${ids.member}', now() - interval '1 day', now() - interval '2 hours'),

      ('00000000-0000-4000-8000-000000020003', '${ids.organization}', '${ids.project}', 'RFI-003',
       'Chi tiết ty treo chống rung và chống động đất cho hệ thang máng cáp điện',
       'Hồ sơ thiết kế kỹ thuật chưa chỉ định chi tiết thanh chống giằng lắc dọc/ngang cho máng cáp nặng trên 40kg/m theo QCVN 06:2022/BXD.',
       'Áp dụng bộ phụ kiện thanh Unistrut và đòn giằng chéo 45 độ của hãng Hilti.',
       'Submitted', 'normal',
       '${ids.locTowerAF2}', '${ids.wbsMep}', '${ids.doc3}', '${ids.mepOrg}',
       '${ids.consultantOrg}', '${ids.consultantOrg}', 5,
       '${ids.member}', now() - interval '6 hours', now() - interval '6 hours')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.rfi_responses (
      id, organization_id, project_id, rfi_id, response_type, content,
      author_user_id, author_partner_organization_id, created_at
    ) VALUES
      ('00000000-0000-4000-8000-000000021001', '${ids.organization}', '${ids.project}',
       '00000000-0000-4000-8000-000000020001', 'official_answer',
       'Chấp thuận đề xuất chia tuyến ống gió thành 2 nhánh kích thước 400x250 để đảm bảo tĩnh không thông thủy tầng hầm tối thiểu 2.2m. Nhà thầu lập bản vẽ Shop drawing chi tiết trình duyệt lại.',
       '${ids.reviewer}', '${ids.consultantOrg}', now() - interval '1 day')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 9. Submittals
  await pool.query(`
    INSERT INTO vinops.submittals (
      id, organization_id, project_id, code, title, submittal_type, status,
      maker_partner_organization_id, lead_contractor_partner_organization_id,
      consultant_partner_organization_id, ball_in_court_organization_id,
      location_node_id, work_node_id, sla_business_days, created_by, created_at, updated_at
    ) VALUES
      ('00000000-0000-4000-8000-000000030001', '${ids.organization}', '${ids.project}', 'SUB-001',
       'Đệ trình mẫu Thép xây dựng CB400-V - Nhà máy Thép Hòa Phát',
       'material_sample', 'Approved',
       '${ids.contractorOrg}', '${ids.contractorOrg}', '${ids.consultantOrg}', '${ids.contractorOrg}',
       '${ids.locTowerA}', '${ids.wbsStr}', 7, '${ids.member}', now() - interval '10 days', now() - interval '5 days'),

      ('00000000-0000-4000-8000-000000030002', '${ids.organization}', '${ids.project}', 'SUB-002',
       'Shop Drawing cốt thép dầm sàn Tầng 2 Tháp A',
       'shop_drawing', 'Under Review',
       '${ids.contractorOrg}', '${ids.contractorOrg}', '${ids.consultantOrg}', '${ids.consultantOrg}',
       '${ids.locTowerAF2}', '${ids.wbsStrSuper}', 5, '${ids.member}', now() - interval '3 days', now() - interval '1 day'),

      ('00000000-0000-4000-8000-000000030003', '${ids.organization}', '${ids.project}', 'SUB-003',
       'Biện pháp thi công đổ bê tông khối lớn đài móng M1 và chống nứt nhiệt',
       'method_statement', 'Approved with Comments',
       '${ids.contractorOrg}', '${ids.contractorOrg}', '${ids.consultantOrg}', '${ids.contractorOrg}',
       '${ids.locTowerAB1}', '${ids.wbsStrSub}', 7, '${ids.member}', now() - interval '7 days', now() - interval '2 days')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.submittal_items (
      id, organization_id, project_id, submittal_id, item_number, description, manufacturer, model_or_grade, sample_quantity
    ) VALUES
      ('00000000-0000-4000-8000-000000031001', '${ids.organization}', '${ids.project}', '00000000-0000-4000-8000-000000030001',
       1, 'Thép thanh vằn D10 - D32 tiêu chuẩn TCVN 1651-2:2018', 'Tập đoàn Hòa Phát', 'Mác CB400-V / CB500-V', 6),
      ('00000000-0000-4000-8000-000000031002', '${ids.organization}', '${ids.project}', '00000000-0000-4000-8000-000000030002',
       1, 'Bản vẽ chi tiết uốn thép dầm D1 đến D8 tầng 2', 'Vinacons EPC', 'Tỷ lệ 1:50, Khổ A1', 1),
      ('00000000-0000-4000-8000-000000031003', '${ids.organization}', '${ids.project}', '00000000-0000-4000-8000-000000030003',
       1, 'Thuyết minh tính toán nhiệt độ thủy hóa xi măng và bố trí ống nước làm mát', 'Viện KHCN Xây dựng IBST', 'Báo cáo số 45/IBST', 1)
    ON CONFLICT (id) DO NOTHING;
  `);

  // 10. Inspection Templates & Checklist Items
  await pool.query(`
    INSERT INTO vinops.inspection_templates (
      id, organization_id, project_id, code, name, status, category, created_by
    ) VALUES
      ('${ids.tplRebar}', '${ids.organization}', '${ids.project}', 'TPL-REBAR-01',
       'Biên bản kiểm tra nghiệm thu cốt thép dầm sàn trước khi đổ bê tông', 'Published', 'rebar', '${ids.owner}'),
      ('${ids.tplConcrete}', '${ids.organization}', '${ids.project}', 'TPL-CONC-01',
       'Biên bản kiểm tra công tác đổ và bảo dưỡng bê tông thương phẩm', 'Published', 'concrete', '${ids.owner}'),
      ('${ids.tplFire}', '${ids.organization}', '${ids.project}', 'TPL-MEP-FIRE-01',
       'Biên bản kiểm tra thử áp lực thủy tĩnh đường ống PCCC', 'Published', 'mep', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.checklist_items (
      id, template_id, item_key, title, description, sequence, criterion_type
    ) VALUES
      ('00000000-0000-4000-8000-000000041001', '${ids.tplRebar}', 'CHK-REBAR-01',
       'Chủng loại, đường kính và quy cách cốt thép đúng bản vẽ thiết kế', 'Kiểm tra mác thép CB400-V và quy cách đường kính', 1, 'pass_fail'),
      ('00000000-0000-4000-8000-000000041002', '${ids.tplRebar}', 'CHK-REBAR-02',
       'Khoảng cách đan thép và chiều dài mối nối chồng buộc/hàn theo TCVN 5574', 'Chiều dài nối buộc tối thiểu 35d', 2, 'pass_fail'),
      ('00000000-0000-4000-8000-000000041003', '${ids.tplRebar}', 'CHK-REBAR-03',
       'Con kê bê tông đảm bảo chiều dày lớp bê tông bảo vệ', 'Con kê đá hoa cương/vữa mác 300, mật độ 4 viên/m2', 3, 'pass_fail'),
      ('00000000-0000-4000-8000-000000041004', '${ids.tplRebar}', 'CHK-REBAR-04',
       'Vệ sinh lòng ván khuôn sạch sẽ, không đọng rác, mùn cưa và bùn đất', 'Xịt rửa sạch trước khi đóng nắp dầm', 4, 'pass_fail'),

      ('00000000-0000-4000-8000-000000041005', '${ids.tplConcrete}', 'CHK-CONC-01',
       'Độ sụt bê tông tươi tại công trường đạt thiết kế', 'Độ sụt yêu cầu: 12 ± 2 cm', 1, 'measurement'),
      ('00000000-0000-4000-8000-000000041006', '${ids.tplConcrete}', 'CHK-CONC-02',
       'Lấy mẫu thí nghiệm nén bê tông (3 tổ mẫu R7, R14, R28)', 'Mỗi 50m3 lấy 1 tổ mẫu 3 viên 15x15x15cm', 2, 'pass_fail')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 11. Inspections & Acceptance Records (ND 207/2026/ND-CP)
  await pool.query(`
    INSERT INTO vinops.inspections (
      id, organization_id, project_id, template_id, code, title, status,
      inspector_id, contractor_rep_id, supervisor_rep_id, location_id, work_item_id,
      inspection_date, attempt_no, notes, created_by
    ) VALUES
      ('${ids.insp1}', '${ids.organization}', '${ids.project}', '${ids.tplRebar}',
       'INSP-2026-001', 'Nghiệm thu cốt thép dầm sàn Tầng 2 Tháp A (Trục 1 đến trục 5)', 'Completed',
       '${ids.reviewer}', '${ids.member}', '${ids.reviewer}', '${ids.locTowerAF2}', '${ids.wbsStrSuper}',
       CURRENT_DATE - interval '2 days', 1, 'Cốt thép thi công đúng bản vẽ Shop drawing Rev-A. Con kê bố trí đầy đủ.', '${ids.reviewer}'),

      ('${ids.insp2}', '${ids.organization}', '${ids.project}', '${ids.tplConcrete}',
       'INSP-2026-002', 'Nghiệm thu công tác đổ bê tông sàn Tầng 2 Tháp A khối lượng 180m3', 'Accepted',
       '${ids.reviewer}', '${ids.member}', '${ids.reviewer}', '${ids.locTowerAF2}', '${ids.wbsStrSuper}',
       CURRENT_DATE - interval '1 day', 1, 'Độ sụt bình quân 13.5cm đạt chuẩn. Đã đúc 6 tổ mẫu nén lưu kho nước bảo dưỡng.', '${ids.reviewer}'),

      ('${ids.insp3}', '${ids.organization}', '${ids.project}', '${ids.tplFire}',
       'INSP-2026-003', 'Kiểm tra thử áp lực đường ống cứu hỏa trục đứng Tầng hầm B1', 'In Progress',
       '${ids.reviewer}', '${ids.member}', '${ids.reviewer}', '${ids.locTowerAB1}', '${ids.wbsMep}',
       CURRENT_DATE, 1, 'Đang duy trì áp lực 12 bar trong 2 giờ theo TCVN 3890.', '${ids.reviewer}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO vinops.acceptance_records (
      id, organization_id, project_id, inspection_id, code, record_type, legal_basis, result, status,
      contractor_signed_by, contractor_signed_at, supervisor_signed_by, supervisor_signed_at,
      pmu_signed_by, pmu_signed_at, conditions_notes, created_by
    ) VALUES
      ('00000000-0000-4000-8000-000000050001', '${ids.organization}', '${ids.project}', '${ids.insp1}',
       'BBNT-2026-STR-001', 'work_acceptance',
       'Nghị định 207/2026/NĐ-CP & Thông tư 32/2026/TT-BXD',
       'Accepted', 'Completed',
       '${ids.member}', now() - interval '2 days',
       '${ids.reviewer}', now() - interval '2 days',
       '${ids.owner}', now() - interval '2 days',
       'Đồng ý cho phép ghép ván khuôn và triển khai đổ bê tông sàn tầng 2.', '${ids.owner}'),

      ('00000000-0000-4000-8000-000000050002', '${ids.organization}', '${ids.project}', '${ids.insp2}',
       'BBNT-2026-STR-002', 'stage_acceptance',
       'Nghị định 207/2026/NĐ-CP & Thông tư 32/2026/TT-BXD',
       'Accepted', 'Completed',
       '${ids.member}', now() - interval '1 day',
       '${ids.reviewer}', now() - interval '1 day',
       '${ids.owner}', now() - interval '1 day',
       'Bê tông đạt hình học, bề mặt đặc chắc không rỗ tổ ong. Tiếp tục bảo dưỡng ẩm 7 ngày liên tục.', '${ids.owner}')
    ON CONFLICT (id) DO NOTHING;
  `);

  // 12. Daily Construction Logs
  await pool.query(`
    INSERT INTO vinops.daily_logs (
      id, organization_id, project_id, contract_package_id, log_date, shift_code, status,
      author_unit, work_summary, notes, created_by
    ) VALUES
      ('${ids.log1}', '${ids.organization}', '${ids.project}', '${ids.contractPackage}',
       CURRENT_DATE - 2, 'day', 'Draft', 'Vinacons EPC',
       'Tiến hành đổ bê tông dầm sàn Tầng 2 Tháp A khối lượng 180m3 bằng 2 xe bơm cần. Hoàn thành công tác đầm láng mặt lúc 17h00.',
       'Công trường an toàn, không có sự cố máy móc. Giao thông xe bồn thuận lợi.', '${ids.member}'),

      ('${ids.log2}', '${ids.organization}', '${ids.project}', '${ids.contractPackage}',
       CURRENT_DATE - 1, 'day', 'Draft', 'Vinacons EPC',
       'Bảo dưỡng nước bê tông sàn tầng 2 bằng bao tải ướt. Gia công lắp dựng cốt thép và ván khuôn cột vách từ tầng 2 lên tầng 3.',
       'Thời tiết nắng ráo, đáp ứng đúng tiến độ chu kỳ 5 ngày/sàn.', '${ids.member}'),

      ('${ids.log3}', '${ids.organization}', '${ids.project}', '${ids.contractPackage}',
       CURRENT_DATE, 'day', 'Submitted', 'Vinacons EPC',
       'Tiếp tục lắp dựng ván khuôn nhôm cột vách trục 1-4 tầng 3. Đội MEP luồn ống chờ cấp điện và ống thoát nước.',
       'Dự kiến nghiệm thu cốt thép cột vào 15h30 chiều.', '${ids.member}')
    ON CONFLICT (id) DO NOTHING;

    -- Daily weather
    INSERT INTO vinops.daily_weather (
      id, daily_log_id, time_of_day, temperature_c, weather_condition, rainfall_mm, wind_force
    ) VALUES
      ('00000000-0000-4000-8000-000000071001', '${ids.log1}', 'morning', 28.5, 'Sunny', 0.0, 'Gió nhẹ cấp 2'),
      ('00000000-0000-4000-8000-000000071002', '${ids.log1}', 'noon', 33.0, 'Cloudy', 0.0, 'Gió cấp 2-3'),
      ('00000000-0000-4000-8000-000000071003', '${ids.log1}', 'afternoon', 31.0, 'Sunny', 0.0, 'Gió cấp 2'),

      ('00000000-0000-4000-8000-000000071004', '${ids.log2}', 'morning', 27.0, 'Sunny', 0.0, 'Gió nhẹ'),
      ('00000000-0000-4000-8000-000000071005', '${ids.log2}', 'noon', 32.5, 'Sunny', 0.0, 'Nắng gắt'),
      ('00000000-0000-4000-8000-000000071006', '${ids.log2}', 'afternoon', 30.0, 'Cloudy', 0.0, 'Mát mẻ'),

      ('00000000-0000-4000-8000-000000071007', '${ids.log3}', 'morning', 28.0, 'Sunny', 0.0, 'Nắng nhẹ'),
      ('00000000-0000-4000-8000-000000071008', '${ids.log3}', 'noon', 33.5, 'Sunny', 0.0, 'Nắng nóng')
    ON CONFLICT (daily_log_id, time_of_day) DO NOTHING;

    -- Daily manpower
    INSERT INTO vinops.daily_manpower (
      id, daily_log_id, trade_or_subcontractor, skill_level, headcount, hours_worked, notes
    ) VALUES
      ('00000000-0000-4000-8000-000000072001', '${ids.log1}', 'Thợ cốp pha nhôm định hình', 'Skilled', 28, 8.0, 'Trực canh cốp pha khi đổ bê tông'),
      ('00000000-0000-4000-8000-000000072002', '${ids.log1}', 'Thợ cốt thép', 'Skilled', 32, 8.0, 'Trực chỉnh sửa thép'),
      ('00000000-0000-4000-8000-000000072003', '${ids.log1}', 'Đội đổ bê tông & đầm dùi', 'Skilled', 16, 10.0, 'Đổ bê tông 2 ca'),
      ('00000000-0000-4000-8000-000000072004', '${ids.log1}', 'Kỹ sư giám sát & trắc đạc', 'Engineer', 6, 8.0, 'Kiểm tra cao độ sàn'),

      ('00000000-0000-4000-8000-000000072005', '${ids.log2}', 'Thợ cốt thép cột vách', 'Skilled', 35, 8.0, 'Lắp dựng thép cột tầng 3'),
      ('00000000-0000-4000-8000-000000072006', '${ids.log2}', 'Thợ mộc ván khuôn', 'Skilled', 25, 8.0, 'Lắp ván khuôn cột'),

      ('00000000-0000-4000-8000-000000072007', '${ids.log3}', 'Thợ cốt thép', 'Skilled', 38, 8.0, 'Buộc thép dầm'),
      ('00000000-0000-4000-8000-000000072008', '${ids.log3}', 'Thợ cơ điện MEP', 'Skilled', 14, 8.0, 'Đặt ống luồn dây điện')
    ON CONFLICT (id) DO NOTHING;

    -- Daily equipment
    INSERT INTO vinops.daily_equipment (
      id, daily_log_id, equipment_name, equipment_type, quantity, hours_worked
    ) VALUES
      ('00000000-0000-4000-8000-000000073001', '${ids.log1}', 'Cần trục tháp Potain MCT 205', 'Lifting', 1, 10.0),
      ('00000000-0000-4000-8000-000000073002', '${ids.log1}', 'Xe bơm bê tông cần Schwing 43m', 'Pumping', 2, 8.0),
      ('00000000-0000-4000-8000-000000073003', '${ids.log1}', 'Máy đầm dùi bê tông Mikasa', 'Compaction', 6, 8.0),

      ('00000000-0000-4000-8000-000000073004', '${ids.log2}', 'Cần trục tháp Potain MCT 205', 'Lifting', 1, 8.0),
      ('00000000-0000-4000-8000-000000073005', '${ids.log2}', 'Máy uốn cắt sắt thủy lực', 'Fabrication', 3, 8.0),

      ('00000000-0000-4000-8000-000000073006', '${ids.log3}', 'Cần trục tháp Potain MCT 205', 'Lifting', 1, 8.0),
      ('00000000-0000-4000-8000-000000073007', '${ids.log3}', 'Máy hàn hồ quang Inverter', 'Welding', 4, 6.0)
    ON CONFLICT (id) DO NOTHING;

    -- Now that child records exist, confirm previous days' logs with digital signatures
    UPDATE vinops.daily_logs
    SET status = 'Confirmed',
        site_manager_signed_by = '${ids.member}',
        site_manager_signed_at = now() - interval '2 days',
        supervisor_signed_by = '${ids.reviewer}',
        supervisor_signed_at = now() - interval '2 days'
    WHERE id = '${ids.log1}';

    UPDATE vinops.daily_logs
    SET status = 'Confirmed',
        site_manager_signed_by = '${ids.member}',
        site_manager_signed_at = now() - interval '1 day',
        supervisor_signed_by = '${ids.reviewer}',
        supervisor_signed_at = now() - interval '1 day'
    WHERE id = '${ids.log2}';
  `);

  console.log('Successfully seeded rich operational data for VinOps!');
}

seed()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
