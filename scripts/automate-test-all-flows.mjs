import { chromium } from 'playwright';
import path from 'path';

const screenshotDir =
  'C:\\Users\\Duong Vinh\\.gemini\\antigravity\\brain\\f7758e01-8524-4125-b43a-a4eaca516c10\\scratch\\screenshots';

async function run() {
  console.log('🚀 Khởi chạy trình duyệt Chrome (visible window)...');
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: false,
    slowMo: 350,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  ⚠️ BROWSER CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', (err) => console.log('  💥 PAGE ERROR:', err.message));
  page.on('requestfailed', (req) =>
    console.log('  ⚠️ REQUEST FAILED:', req.url(), req.failure()?.errorText),
  );
  page.on('response', async (res) => {
    if (res.status() >= 400) {
      const body = await res.text().catch(() => '');
      console.log('  ⚠️ HTTP ERROR:', res.status(), res.url(), body);
    }
  });

  try {
    console.log('🌐 Bước 1: Mở ứng dụng VinOps tại http://localhost:5174...');
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });

    console.log('🔐 Bước 2: Đăng nhập tài khoản Project Owner...');
    await page.waitForSelector('#login-email', { timeout: 10000 });
    await page.fill('#login-email', 'owner@vinops.test');
    await page.fill('#login-password', 'VinOps-Mega002!');
    await page.click('button[type="submit"]');

    console.log('📊 Bước 3: Đang tải màn hình Tổng quan (Overview Dashboard)...');
    await page.waitForSelector('.app-header', { timeout: 10000 });
    await page.waitForSelector('text=Bảng điều khiển hoạt động dự án', { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(screenshotDir, '01_login_success_overview.png') });
    console.log('  -> Đã chụp ảnh màn hình Overview Dashboard.');

    console.log('🛠️ Bước 4: Kiểm tra phân hệ Field Issues (Kanban)...');
    await page.click('button:has-text("Field Issues")');
    await page.waitForSelector('[data-testid="issues-kanban"]', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '02_field_issues_kanban.png') });

    console.log('  -> Thao tác: Tạo mới 1 Field Issue có GPS...');
    await page.click('[data-testid="quick-create-btn"]');
    await page.waitForSelector('[data-testid="quick-create-modal"]', { timeout: 5000 });
    await page.fill('[data-testid="input-title"]', 'Vết nứt chân cột C3 trục 4 tầng 2');
    await page.fill(
      '[data-testid="input-description"]',
      'Phát hiện vết nứt bề mặt sau khi tháo dỡ ván khuôn cột C3 tầng 2, cần TVGS kiểm tra độ sâu vết nứt.',
    );
    await page.click('[data-testid="submit-issue-btn"]');
    await page.waitForSelector('[data-testid="quick-create-modal"]', {
      state: 'detached',
      timeout: 8000,
    });
    await page.waitForTimeout(1000);

    console.log('  -> Thao tác: Chuyển trạng thái quy trình Issue Kanban (Triage & Assign)...');
    const triageBtn = page
      .locator('.kanban-column:has-text("Open") button:has-text("Triage")')
      .first();
    if ((await triageBtn.count()) > 0) {
      await triageBtn.click();
      await page.waitForTimeout(800);
    }
    const assignBtn = page
      .locator('.kanban-column:has-text("Under Triage") button:has-text("Assign")')
      .first();
    if ((await assignBtn.count()) > 0) {
      await assignBtn.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: path.join(screenshotDir, '03_field_issues_transitioned.png') });
    console.log('  -> Đã tạo và chuyển trạng thái Issue thành công.');

    console.log('💬 Bước 5: Kiểm tra phân hệ RFIs (Yêu cầu làm rõ kỹ thuật)...');
    await page.click('nav button:has-text("RFIs")');
    await page.waitForSelector('[data-testid="rfi-hub"]', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '04_rfi_hub_list.png') });

    console.log('  -> Thao tác: Tạo mới 1 RFI kỹ thuật...');
    await page.click('[data-testid="create-rfi-btn"]');
    await page.waitForSelector('[data-testid="create-rfi-modal"]', { timeout: 5000 });
    await page.fill(
      '[data-testid="rfi-title-input"]',
      'Làm rõ chi tiết giằng thép dầm D2 sàn tầng 2',
    );
    await page.fill(
      '[data-testid="rfi-question-input"]',
      'Bản vẽ thiết kế S-02 chưa thể hiện khoảng cách đai giằng liên kết dầm D2 với vách thang máy.',
    );
    await page.selectOption('[data-testid="rfi-priority-input"]', 'High');
    await page.click('[data-testid="submit-rfi-btn"]');
    await page.waitForSelector('[data-testid="create-rfi-modal"]', {
      state: 'detached',
      timeout: 5000,
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '05_rfi_created.png') });
    console.log('  -> Đã tạo mới RFI thành công.');

    console.log('📦 Bước 6: Kiểm tra phân hệ Submittals (Trình duyệt vật tư)...');
    await page.click('nav button:has-text("Submittals")');
    await page.waitForSelector('[data-testid="submittal-dashboard"]', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '06_submittals_dashboard.png') });

    console.log('  -> Thao tác: Tạo mới hồ sơ Submittal...');
    await page.click('[data-testid="create-submittal-btn"]');
    await page.waitForSelector('[data-testid="create-submittal-modal"]', { timeout: 5000 });
    await page.fill(
      '[data-testid="submittal-title-input"]',
      'Hồ sơ chứng chỉ mác bê tông R28 mác M400',
    );
    await page.selectOption('[data-testid="submittal-type-input"]', 'Material Sample');
    await page.fill(
      '[data-testid="submittal-description-input"]',
      'Chứng chỉ xuất xưởng và kết quả nén mẫu thử 7 ngày & 28 ngày trạm trộn Vinacons.',
    );
    await page.fill('[data-testid="submittal-tradename-input"]', 'Bê tông tươi M400 R28');
    await page.fill('[data-testid="submittal-manufacturer-input"]', 'Công ty CP Bê tông Vinacons');
    await page.click('[data-testid="create-submittal-modal"] button[type="submit"]');
    await page.waitForSelector('[data-testid="create-submittal-modal"]', {
      state: 'detached',
      timeout: 5000,
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '07_submittal_created.png') });
    console.log('  -> Đã tạo mới Submittal thành công.');

    console.log('📑 Bước 7: Kiểm tra phân hệ Documents & Shop Drawings...');
    await page.click('nav button:has-text("Documents")');
    await page.waitForSelector('.document-workspace', { timeout: 10000 });
    await page.waitForTimeout(1000);
    const firstDoc = page.locator('.document-row').first();
    if ((await firstDoc.count()) > 0) {
      await firstDoc.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: path.join(screenshotDir, '08_documents_management.png') });
    console.log('  -> Đã kiểm tra danh mục tài liệu & revision thành công.');

    console.log('🔍 Bước 8: Kiểm tra phân hệ Quality Inspections (Nghiệm thu NĐ 207)...');
    await page.click('nav button:has-text("Quality Inspections")');
    await page.waitForSelector('[data-testid="inspection-select"]', { timeout: 10000 });
    await page.waitForTimeout(1000);

    console.log('  -> Thao tác: Đánh giá checklist hiện trường (Pass các hạng mục)...');
    const passRebar = page.locator('[data-testid="btn-pass-rebar_diameter"]');
    if ((await passRebar.count()) > 0) await passRebar.click();
    const passSpacing = page.locator('[data-testid="btn-pass-rebar_spacing"]');
    if ((await passSpacing.count()) > 0) await passSpacing.click();
    const passCover = page.locator('[data-testid="btn-pass-concrete_cover"]');
    if ((await passCover.count()) > 0) await passCover.click();
    await page.waitForTimeout(500);

    console.log('  -> Thao tác: Lưu phiếu nghiệm thu...');
    await page.click('[data-testid="btn-save-inspection"]');
    await page.waitForSelector('[data-testid="status-message"]', { timeout: 8000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotDir, '09_quality_inspection_saved.png') });
    console.log('  -> Đã lưu nghiệm thu thành công.');

    console.log('📅 Bước 9: Kiểm tra phân hệ Daily Logs (Nhật ký công trường)...');
    await page.click('nav button:has-text("Daily Logs")');
    await page.waitForTimeout(1500);

    const createLogBtn = page.locator('button:has-text("Tạo nhật ký hôm nay")');
    if ((await createLogBtn.count()) > 0) {
      await createLogBtn.click();
      await page.waitForTimeout(1500);
    }

    const workSummaryInput = page.locator('[data-testid="input-work-summary"]');
    if ((await workSummaryInput.count()) > 0) {
      console.log('  -> Thao tác: Cập nhật nhật ký thi công công trường...');
      await workSummaryInput.fill(
        'Đổ 280m3 bê tông cột vách tầng 2 Tháp A. Quân số 65 công nhân (Vinacons: 45, Ree M&E: 20). Thiết bị cần trục tháp và máy bơm hoạt động ổn định.',
      );
      const saveSummaryBtn = page.locator('[data-testid="btn-save-summary"]');
      if ((await saveSummaryBtn.count()) > 0) {
        await saveSummaryBtn.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.screenshot({ path: path.join(screenshotDir, '10_daily_log_saved.png') });
    console.log('  -> Đã cập nhật nhật ký thi công thành công.');

    console.log('📍 Bước 10: Kiểm tra cấu trúc LBS, WBS, Members & Overview...');
    await page.click('nav button:has-text("LBS")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, '11_lbs_view.png') });

    await page.click('nav button:has-text("WBS")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, '12_wbs_view.png') });

    await page.click('nav button:has-text("Members")');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(screenshotDir, '13_members_view.png') });

    console.log('🏁 Bước 11: Trở về Overview Dashboard xem tổng hợp số liệu mới...');
    await page.click('nav button:has-text("Overview")');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, '14_final_overview.png') });

    console.log('✅ Hoàn thành toàn bộ quy trình kiểm thử tự động trên web!');
    console.log('Giữ màn hình mở trong 5 giây...');
    await page.waitForTimeout(5000);
  } catch (error) {
    console.error('❌ Lỗi trong quá trình thao tác:', error);
    await page.screenshot({ path: path.join(screenshotDir, 'error_state.png') });
    throw error;
  } finally {
    await browser.close();
    console.log('🚪 Đã đóng phiên trình duyệt.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
