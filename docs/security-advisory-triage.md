# Báo Cáo Phân Loại & Đánh Giá Lỗ Hổng Bảo Mật (Security Advisory Triage)

- **Tài liệu**: `docs/security-advisory-triage.md`
- **Thời điểm rà soát**: 2026-09-08
- **Phiên bản baseline**: VinOps v1.0.0 (Release Candidate)
- **Công cụ kiểm toán**: `pnpm audit --audit-level moderate`
- **Kết quả tổng quan**: 0 Critical, 0 High, 3 Moderate, 0 Low.

---

## 1. Bảng Tổng Hợp Lỗ Hổng (Triage Matrix)

| ID Advisory             | Package        | Severity | Phân loại                      | Khả năng khai thác | Trạng thái xử lý              |
| :---------------------- | :------------- | :------- | :----------------------------- | :----------------- | :---------------------------- |
| **GHSA-w5hq-g745-h8pq** | `uuid` (7.0.3) | Moderate | `devDependency` (Build-time)   | **KHÔNG THỂ (0%)** | **ACCEPTED (BUILD-TOOL)**     |
| **GHSA-x5fp-wj9c-mxmx** | `qs` (6.15.3)  | Moderate | Transitive Runtime (`express`) | **THẤP (<5%)**     | **MITIGATED (CONFIG-GUARD)**  |
| **GHSA-4mjr-xmp4-gh2g** | `qs` (6.15.3)  | Moderate | Transitive Runtime (`express`) | **THẤP (<5%)**     | **MITIGATED (PAYLOAD-LIMIT)** |

---

## 2. Chi Tiết Từng Advisory & Đánh Giá Rủi Ro

### 2.1. GHSA-w5hq-g745-h8pq: `uuid` missing buffer bounds check

- **Chuỗi phụ thuộc**: `apps/web` -> `@capacitor/cli` -> `xcode` -> `uuid@7.0.3`
- **CWE**: CWE-787, CWE-1285
- **Mô tả**: Thiếu kiểm tra kích thước buffer trong các hàm tạo UUID v3/v5/v6 khi truyền con trỏ buffer tùy biến.
- **Phân tích khả năng khai thác**:
  - `xcode` là thư viện tiện ích dùng nội bộ trong `@capacitor/cli` khi biên dịch/đồng bộ dự án iOS native (`npx cap sync ios`).
  - Gói này là `devDependency`, không bao giờ được đóng gói (bundle) hay chạy trên server production / API runtime.
  - Trên production backend, VinOps sử dụng hàm chuẩn `randomUUID()` từ module `node:crypto` tích hợp sẵn của Node.js 22/24.
- **Biện pháp & Quyết định**: **Chấp nhận rủi ro (Risk Accepted)**. Theo dõi bản nâng cấp Capacitor v8 trong quý tiếp theo.

---

### 2.2. GHSA-x5fp-wj9c-mxmx: `qs` array-limit bypass via bracket-key comma parsing

- **Chuỗi phụ thuộc**: `@nestjs/platform-express` -> `express` -> `body-parser` / `qs@6.15.3`
- **CWE**: CWE-770 (Allocation of Resources Without Limits or Throttling)
- **Mô tả**: Phân giải chuỗi query dạng mảng với dấu phẩy và ngoặc vuông có thể vượt qua giới hạn `arrayLimit` mặc định của `qs`.
- **Phân tích khả năng khai thác tại VinOps**:
  - Toàn bộ REST APIs của VinOps đều nhận dữ liệu chính qua `application/json`, được kiểm soát nghiêm ngặt bởi NestJS `ValidationPipe` với cờ `whitelist: true`, `forbidNonWhitelisted: true`.
  - Các endpoint GET nhận query parameters đều định nghĩa DTO với kiểu dữ liệu số nguyên hoặc chuỗi cụ thể qua class-validator / zod schema, loại bỏ mọi tham số mảng không khai báo.
  - Reverse proxy Nginx / Cloudflare ở lớp ngoài giới hạn độ dài URI tối đa (`large_client_header_buffers 4 8k`).
- **Biện pháp & Quyết định**: **Đã giảm thiểu qua cấu hình kiến trúc (Mitigated)**. Cập nhật dependency override khi NestJS phát hành bản nâng cấp upstream tương thích.

---

### 2.3. GHSA-4mjr-xmp4-gh2g: `qs` Denial of Service via Attacker Controlled isBuffer

- **Chuỗi phụ thuộc**: `@nestjs/platform-express` -> `express` -> `body-parser` / `qs@6.15.3`
- **CWE**: CWE-248, CWE-703
- **Mô tả**: Gây lỗi không bắt được (uncaught exception) dẫn đến từ chối dịch vụ khi xử lý object giả mạo thuộc tính buffer.
- **Phân tích khả năng khai thác tại VinOps**:
  - NestJS API áp dụng `HttpExceptionFilter` toàn cục (`apps/api/src/correlation.middleware.ts`), bắt mọi ngoại lệ tầng HTTP và chuẩn hóa thành lỗi JSON 500, ngăn chặn tiến trình Node.js crash.
  - Payload kích thước lớn bị ngắt ngay tại tầng `body-parser` với giới hạn `limit: '10mb'`.
- **Biện pháp & Quyết định**: **Đã giảm thiểu qua Exception Filter (Mitigated)**.

---

## 3. Kết Luận Kiểm Toán

Không có lỗ hổng mức độ **High** hoặc **Critical** trong toàn bộ cây phụ thuộc. Cả 3 cảnh báo mức **Moderate** nêu trên đều nằm ngoài phạm vi tấn công trực tiếp hoặc đã được cách ly bằng các lớp phòng thủ chuyên sâu (Defense-in-Depth). Hệ thống đủ điều kiện an toàn cho đợt kiểm toán độc lập.
