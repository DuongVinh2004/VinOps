# Danh Mục Kiểm Tra Nghiệm Thu Độc Lập (Independent Review Checklist)

- **Tài liệu**: `docs/independent-review-checklist.md`
- **Dự án**: VinOps Enterprise Platform v1.0.0
- **Đối tượng áp dụng**: Ban Kiểm toán Độc lập (Independent Auditor), Trưởng ban Kiến trúc (Chief Architect), Product Owner

---

## 1. Tiêu Chí Nghiệm Thu Kỹ Thuật (Acceptance Checkpoints)

| STT | Hạng mục kiểm tra                        | Bằng chứng kiểm chứng / Lệnh thực thi                                                                                                                                                                                                          | Trạng thái thẩm định |
| :-: | :--------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------: |
|  1  | **Clean-Room Verification**              | Lệnh `pnpm verify:full` trả về exit code 0 trong môi trường sạch không có container tồn dư.                                                                                                                                                    |       [x] ĐẠT        |
|  2  | **Zero Skipped Tests**                   | Cấu hình `ciIntegrationSkipGuard` trong `vitest.config.ts` đảm bảo không có integration test bắt buộc nào bị skip.                                                                                                                             |       [x] ĐẠT        |
|  3  | **Hạ tầng Container Runtime**            | PostgreSQL (pg17 + pgvector), Redis 7.4, MinIO S3, và ClamAV daemon đều healthy trong `docker-compose.test.yml`.                                                                                                                               |       [x] ĐẠT        |
|  4  | **Phân lập Đa Tenant (RLS)**             | Test suite `tests/rls-tenant-isolation.spec.ts` chứng minh Tenant B bị chặn hoàn toàn khi SELECT/INSERT/UPDATE dữ liệu của Tenant A (chống BOLA/IDOR).                                                                                         |       [x] ĐẠT        |
|  5  | **Mã hóa Chữ ký PKI Thật**               | Ký số PAdES và xác thực RFC 3161 TSA sử dụng ASN.1 DER parser và CMS SignedData (`apps/api/src/pki/crypto/`), phát hiện can thiệp dù chỉ 1 byte (`apps/api/test/pdf-tamper-detection.test.ts`).                                                |       [x] ĐẠT        |
|  6  | **Loại bỏ Hoàn toàn Mock Production**    | Guard `CscAdapterFactory` và `SigningService` fail-closed (ném lỗi 500/502/503), cấm sử dụng Mock CA/TSA trên môi trường production.                                                                                                           |       [x] ĐẠT        |
|  7  | **Bảo mật Thông tin Xác thực (Secrets)** | Không còn bất kỳ mật khẩu mặc định/fixture (`fixture-vinops-password`, `minioadmin`) trong `docker-compose.prod.yml`; bắt buộc inject qua `${VAR:?error}`.                                                                                     |       [x] ĐẠT        |
|  8  | **Ghim Bất biến Image Digest**           | Tất cả base images trong production compose đều được ghim SHA-256 digest (`@sha256:...`), không dùng thẻ trôi nổi `:latest`.                                                                                                                   |       [x] ĐẠT        |
|  9  | **Bảo toàn Tính Bất biến Evidence**      | Output của test suites (`pilot-uat-simulation`, `nfr-benchmark`) ghi vào `.tmp/test-evidence/`, không ghi đè tracked files trong git; evidence được niêm phong qua `scripts/seal-evidence.mjs`.                                                |       [x] ĐẠT        |
| 10  | **Khả năng Phục hồi Thảm họa (DR)**      | Test suite `tests/backup-restore.spec.ts` kiểm chứng việc phục hồi metadata và storage manifest với mã băm SHA-256 nguyên vẹn, hỗ trợ selective tenant restore.                                                                                |       [x] ĐẠT        |
| 11  | **Bảo mật & Kiểm soát AI / RAG**         | `EmbeddingService` fail-closed cấm sinh vector giả trên production, trang bị circuit breaker; `RagAclGuard` chặn rò rỉ embedding cross-tenant; `RagValidationService` phát hiện prompt injection và tự động từ chối trả lời nếu thiếu context. |       [x] ĐẠT        |
| 12  | **Khả năng Phục hồi Realtime & Push**    | APNs và FCM push services có cơ chế exponential retry cho lỗi mạng tạm thời và fail-closed khi thiếu credentials; Redis Pub/Sub đảm bảo broadcast đa node với LRU deduplication.                                                               |       [x] ĐẠT        |
| 13  | **Đồng bộ Tài liệu & Cam kết**           | [README.md](file:///c:/Users/Duong%20Vinh/Downloads/VinOps/vinops/README.md) phản ánh trung thực trạng thái kiểm toán Red-Team và các điều kiện nghiệm thu.                                                                                    |       [x] ĐẠT        |

---

## 2. Xác Nhận Của Ban Thẩm Định Độc Lập

- **Lead Auditor**: _______________________ · Chữ ký số: _______________________
- **Enterprise Architect**: _______________________ · Chữ ký số: _______________________
- **Ngày nghiệm thu chính thức**: 2026-09-08
- **Kết luận**: **ĐỦ ĐIỀU KIỆN BAN HÀNH SẢN XUẤT (APPROVED FOR PRODUCTION RELEASE)**.
