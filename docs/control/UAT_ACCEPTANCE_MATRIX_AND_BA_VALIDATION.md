# Ma trận Nghiệm thu Người dùng (UAT) & Khung Xác thực Giả định BA (Gate C)

**Dự án:** VinOps Platform  
**Phiên bản kiểm soát:** Gate C Readiness Baseline  
**Mục tiêu:** Cung cấp ma trận kiểm thử nghiệm thu người dùng (User Acceptance Testing - UAT) toàn diện cho các luồng nghiệp vụ Mega-Slice A, B, C và khung câu hỏi xác thực giả định phân tích nghiệp vụ (BA Validation) cho OQ-002..007, ASM-001..006 theo PRSS v3.1 và ER-012.

---

## 1. Ma trận Nghiệm thu Người dùng (UAT Matrix)

### 1.1. Mega-Slice A: Quản lý Hồ sơ & CDE theo ISO 19650

| Mã UAT         | Vai trò (Persona)      | Quy trình Nghiệp vụ                        | Dữ liệu Đầu vào & Điều kiện                                                  | Kết quả Kỳ vọng (Expected Result)                                                                     | Tiêu chí Đạt (Pass Criteria)                                                                                   |
| -------------- | ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **UAT-CDE-01** | Document Controller    | Đăng ký & Tải lên tài liệu kỹ thuật mới    | Tệp bản vẽ PDF/DWG, mã hiệu tài liệu theo cấu hình dự án (Numbering Profile) | Hệ thống tạo phiên bản Draft, kiểm tra virus/mã độc bất đồng bộ qua ClamAV, tính mã băm SHA-256       | Tài liệu ở trạng thái Draft, SHA-256 được lưu vết, tệp an toàn được chuyển từ quarantine sang business storage |
| **UAT-CDE-02** | Lead Consultant (TVGS) | Phê duyệt & Phát hành bản vẽ chính thức    | Tài liệu đã qua thẩm tra, quyết định phê duyệt (Approved/Suitability S1-S4)  | Tạo phiên bản Published, cấp mã QR pháp lý xác minh thực địa, khóa chỉnh sửa phiên bản cũ             | Bản vẽ có mã QR tra cứu tính pháp lý, banner cảnh báo superseded tự động kích hoạt nếu có phiên bản sau        |
| **UAT-CDE-03** | Site Engineer          | Quét mã QR bản vẽ tại công trường          | Quét mã QR in trên bản vẽ giấy bằng thiết bị di động                         | Hiển thị màn hình xác thực tính pháp lý: Phiên bản mới nhất (Current) hay đã bị thay thế (Superseded) | Phản hồi trạng thái bản vẽ trong < 1 giây, cảnh báo rõ ràng nếu bản vẽ giấy đã hết hiệu lực thi công           |
| **UAT-CDE-04** | Project Admin          | Xuất hồ sơ bàn giao (Transmittal Manifest) | Danh sách tài liệu thuộc gói thầu nghiệm thu giai đoạn                       | Xuất file nén As-Built Dossier đính kèm file kê khai manifest.json và checksum sha256 toàn vẹn        | Tệp ZIP chứa đầy đủ bản vẽ, biên bản và manifest xác thực toàn vẹn không bị thiếu sót                          |

### 1.2. Mega-Slice B: Quản lý Hiện trường & RFX (Field Issues, RFI, Submittals)

| Mã UAT         | Vai trò (Persona)                     | Quy trình Nghiệp vụ                        | Dữ liệu Đầu vào & Điều kiện                                                                     | Kết quả Kỳ vọng (Expected Result)                                                             | Tiêu chí Đạt (Pass Criteria)                                                         |
| -------------- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **UAT-RFX-01** | Field Inspector                       | Ghi nhận sự cố hiện trường trên Kanban     | Tiêu đề sự cố, phân loại (Chất lượng/An toàn), mức độ nghiêm trọng, ảnh hiện trường, tọa độ GPS | Thẻ sự cố xuất hiện trên cột "Open" của bảng Kanban, thông báo cho Chỉ huy trưởng nhà thầu    | Thẻ sự cố lưu đúng tọa độ GPS, hiển thị trên Kanban đúng cột trạng thái              |
| **UAT-RFX-02** | Contractor PM                         | Leo thang sự cố hiện trường thành RFI      | Sự cố vướng mắc kỹ thuật cần TVTK/TVGS làm rõ, câu hỏi RFI, thời hạn phản hồi                   | Hệ thống tự động tạo RFI liên kết với Issue gốc, chuyển Ball-in-Court sang đơn vị Tư vấn      | RFI mang mã liên kết `source_issue_id`, trạng thái Issue cập nhật liên kết leo thang |
| **UAT-RFX-03** | Lead Consultant                       | Trả lời chính thức RFI (Official Response) | Nội dung giải pháp kỹ thuật, tài liệu chỉ dẫn đính kèm                                          | RFI chuyển sang trạng thái "Official Answered", xóa Ball-in-Court, gửi thông báo cho Nhà thầu | Nội dung chỉ dẫn rõ ràng, lưu vết thời gian phản hồi phục vụ đánh giá SLA            |
| **UAT-RFX-04** | Contractor Maker / Consultant Checker | Đệ trình vật tư theo cơ chế Maker-Checker  | Hồ sơ mẫu vật tư đá Granite 600x600, chứng chỉ CO/CQ, đơn vị sản xuất                           | Maker nộp hồ sơ -> Trạng thái Under Review; Checker duyệt phê duyệt Code A                    | Trạng thái Submittal chuyển sang Approved, lưu vết biên bản đánh giá của Checker     |

### 1.3. Mega-Slice C: Quản lý Chất lượng & Nhật ký Thi công Điện tử (NĐ 207/2026/NĐ-CP)

| Mã UAT         | Vai trò (Persona)         | Quy trình Nghiệp vụ                                | Dữ liệu Đầu vào & Điều kiện                                                         | Kết quả Kỳ vọng (Expected Result)                                                                     | Tiêu chí Đạt (Pass Criteria)                                                                                |
| -------------- | ------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **UAT-QLT-01** | Nhà thầu -> TVGS -> BQLDA | Ký số tuần tự 3 bên biên bản nghiệm thu công việc  | Biên bản nghiệm thu bê tông móng, checklist đạt yêu cầu                             | Tuân thủ nghiêm ngặt quy trình ký tuần tự: Nhà thầu ký trước -> TVGS ký thứ hai -> BQLDA ký cuối cùng | Nghiêm cấm ký vượt cấp; BQLDA chỉ ký được khi TVGS đã ký; sau khi BQLDA ký thì biên bản chuyển Completed    |
| **UAT-QLT-02** | QA/QC Officer             | Độc lập thẩm định khắc phục sự cố (SoD CAR)        | Phiếu yêu cầu khắc phục (CAR) mức độ High hoặc Critical do chính mình thực hiện     | Người trực tiếp khắc phục KHÔNG ĐƯỢC tự thẩm định đóng phiếu (Phân tách nhiệm vụ SoD)                 | Hệ thống chặn thao tác tự đóng phiếu với lỗi DomainError / 403 Forbidden; bắt buộc nhân sự độc lập thẩm tra |
| **UAT-QLT-03** | Chỉ huy trưởng & TVGS     | Xác nhận & Đóng băng Nhật ký thi công ngày         | Nội dung nhật ký ngày, ảnh thi công, tọa độ GPS công trình, chữ ký điện tử 2 bên    | Khi cả Chỉ huy trưởng và TVGS đã ký xác nhận (Confirmed), nhật ký bị đóng băng bất biến               | Không thể sửa chữa, xóa hay thêm mới dữ liệu vào nhật ký đã Confirmed (bảo toàn chứng cứ pháp lý)           |
| **UAT-QLT-04** | Giám sát hiện trường      | Kiểm tra nghiệm thu ngoại tuyến trên Mobile/Tablet | Thiết bị mất mạng (Offline), thực hiện đánh giá checklist Pass/Fail, lưu tọa độ GPS | Dữ liệu lưu an toàn vào hàng đợi ngoại tuyến thiết bị; khi có mạng trở lại tự động đồng bộ lên server | Tác vụ đồng bộ hoàn tất không mất mát dữ liệu, tự động phát hiện và cảnh báo nếu có xung đột phiên bản      |

---

## 2. Khung Xác thực Giả định Nghiệp vụ (BA Validation Framework)

Căn cứ PRSS v3.1 (§37-41) và nhiệm vụ chuẩn bị nghiệm thu Gate C, dưới đây là bộ câu hỏi và tiêu chí xác thực cho các giả định (ASM) và câu hỏi mở (OQ).

### 2.1. Xác thực các Giả định Nền tảng (ASM-001 .. ASM-006)

#### ASM-001: Dữ liệu phân tán qua nhiều kênh không chính thống

- **Giả định:** Khách hàng mục tiêu đang quản lý hồ sơ, sự cố và nghiệm thu phân mảnh qua Zalo, email, Excel và bản cứng, dẫn đến thất lạc thông tin và chậm trễ tiến độ.
- **Bộ câu hỏi phỏng vấn BA:**
  1. Hiện tại đơn vị ghi nhận và xử lý các sự cố phát sinh trên công trường qua những kênh nào?
  2. Thời gian trung bình để một yêu cầu làm rõ (RFI) từ nhà thầu đến khi nhận được văn bản trả lời chính thức là bao lâu?
  3. Đã từng xảy ra trường hợp thi công sai bản vẽ do sử dụng nhầm phiên bản cũ phát tán qua chat chưa?
- **Tiêu chí xác thực (Exit Criteria):** Tối thiểu 5 cuộc phỏng vấn sâu với Giám đốc dự án / Chỉ huy trưởng xác nhận thực trạng; có bằng chứng phân mảnh dữ liệu.

#### ASM-002: Người mua trả tiền đầu tiên (Tenant Buyer) là Tổng thầu / Nhà thầu chính

- **Giả định:** Đối tượng sẵn sàng chi trả gói phần mềm ban đầu là Tổng thầu xây dựng (để tối ưu hóa điều hành công trường và giảm thiểu rủi ro pháp lý).
- **Bộ câu hỏi phỏng vấn BA:**
  1. Ngân sách chuyển đổi số và phần mềm quản lý hiện trường do Chủ đầu tư cấp phát hay trích từ chi phí quản lý của Tổng thầu?
  2. Động lực lớn nhất để Tổng thầu áp dụng VinOps: Giảm rủi ro phạt tiến độ, kiểm soát thầu phụ hay minh bạch với TVGS?
- **Tiêu chí xác thực (Exit Criteria):** Xác nhận Persona mua hàng thông qua Discovery Sales với 3 Tổng thầu cấp I.

#### ASM-003: Hồ sơ đệ trình (RFA / Submittal) bao phủ vật tư, bản vẽ shop và biện pháp thi công

- **Giả định:** Một phân hệ Submittal thống nhất có thể quản lý cả 3 nhóm đệ trình: Vật liệu mẫu (Material Sample), Bản vẽ thi công (Shop Drawing), và Biện pháp thi công (Method Statement).
- **Bộ câu hỏi phỏng vấn BA:**
  1. Biểu mẫu và luồng phê duyệt giữa mẫu vật liệu và biện pháp thi công có sự khác biệt cốt lõi nào không?
  2. Thời hạn chuẩn (SLA) để Tư vấn phê duyệt từng loại đệ trình theo quy định hợp đồng là bao nhiêu ngày?
- **Tiêu chí xác thực (Exit Criteria):** Thu thập và chuẩn hóa 3 bộ mẫu hồ sơ đệ trình thực tế từ các dự án đang triển khai.

#### ASM-004: Thẩm quyền đóng RFI thuộc về người tạo hoặc người được ủy quyền

- **Giả định:** RFI sau khi nhận câu trả lời kỹ thuật từ Tư vấn sẽ do chính người gửi (Nhà thầu) kiểm tra sự thỏa đáng và thực hiện đóng (Close).
- **Bộ câu hỏi phỏng vấn BA:**
  1. Khi TVGS/TVTK đưa ra phản hồi kỹ thuật, ai là người có thẩm quyền kết luận câu trả lời đã đầy đủ để đóng RFI?
  2. Trường hợp câu trả lời làm phát sinh chi phí hoặc thay đổi tiến độ, thủ tục chuyển giao sang quy trình Change Order diễn ra như thế nào?
- **Tiêu chí xác thực (Exit Criteria):** Thống nhất sơ đồ luồng đóng RFI trong hội thảo kỹ thuật với đại diện pháp lý và quản lý hợp đồng.

#### ASM-005: Tách bạch giữa Checklist kiểm tra nội bộ và Biên bản nghiệm thu chính thức

- **Giả định:** Nhà thầu cần phân hệ checklist kiểm tra nội bộ riêng trước khi phát hành Thư mời nghiệm thu chính thức gửi TVGS và Chủ đầu tư.
- **Bộ câu hỏi phỏng vấn BA:**
  1. Đơn vị có yêu cầu bắt buộc nghiệm thu nội bộ đạt 100% trước khi gửi phiếu yêu cầu nghiệm thu cho TVGS không?
  2. Checklist nội bộ có cần lưu trữ vĩnh viễn trong hồ sơ chất lượng công trình theo NĐ 207/2026/NĐ-CP không?
- **Tiêu chí xác thực (Exit Criteria):** Khảo sát quy chế QA/QC của 3 nhà thầu chính; phân định rõ entity dữ liệu giữa kiểm tra nội bộ và nghiệm thu bàn giao.

#### ASM-006: Mỗi dự án duy trì duy nhất một Phiên bản hiện hành (Current Revision) theo ngữ cảnh phân phối

- **Giả định:** Trong cùng một ngữ cảnh phân phối (Distribution Context), tại một thời điểm chỉ tồn tại duy nhất một bản vẽ có trạng thái "Current", các bản vẽ trước đó tự động chuyển "Superseded".
- **Bộ câu hỏi phỏng vấn BA:**
  1. Dự án quản lý việc phát hành bản vẽ cho nhiều thầu phụ khác nhau như thế nào nếu phạm vi công việc giao thoa?
  2. Khi có Revision mới, thủ tục thu hồi hoặc đánh dấu hủy hiệu lực bản vẽ giấy cũ tại hiện trường được thực hiện ra sao?
- **Tiêu chí xác thực (Exit Criteria):** Kiểm chứng với chuyên viên Document Controller; đảm bảo hệ thống bất biến không thể tồn tại 2 bản vẽ Current trùng mã.

---

### 2.2. Xác thực các Câu hỏi Mở Nghiệp vụ (OQ-002 .. OQ-007)

| Mã OQ      | Vấn đề Cần Xác thực                                                                    | Đề xuất Cấu hình Mặc định (Default Baseline)                                                                                                              | Bộ Câu hỏi Phỏng vấn Các Bên Tham gia                                                                                                                                   | Kịch bản Điều chỉnh (Change Trigger)                                                                       |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **OQ-002** | Ma trận chức danh và thẩm quyền ký biên bản nghiệm thu theo từng loại công việc?       | Cấu hình linh hoạt theo dự án (`configurable authority`); mặc định hỗ trợ tuần tự 3 bên (Nhà thầu, TVGS, BQLDA) theo NĐ 207/2026/NĐ-CP.                   | 1. Dự án có áp dụng chữ ký điện tử trực tiếp trên tablet ngoài hiện trường không?<br>2. Những biên bản nào cho phép 2 bên (Nhà thầu + TVGS) mà không cần BQLDA?         | Khi hợp đồng FIDIC hoặc quy chế dự án quy định thẩm quyền ký đặc thù không cần BQLDA.                      |
| **OQ-003** | Thẩm quyền đóng RFI: Người gửi, Giám đốc dự án hay Document Controller?                | Người gửi RFI hoặc người được ủy quyền (Sender or Delegate) thực hiện đóng sau khi xác nhận phản hồi thỏa đáng.                                           | 1. Có cho phép Document Controller thay mặt Chỉ huy trưởng đóng RFI hành chính không?<br>2. Trường hợp tranh chấp câu trả lời RFI, ai là người phân xử cuối cùng?       | Dự án yêu cầu chỉ duy nhất Project Manager mới có quyền chốt đóng RFI có ảnh hưởng chi phí.                |
| **OQ-004** | Phân loại trạng thái và lộ trình phê duyệt Submittal thực tế?                          | Phân loại: Vật liệu mẫu, Bản vẽ shop, Biện pháp; Lộ trình: Draft -> Submitted -> Under Review -> Approved (Code A/B/C/D) -> Closed.                       | 1. Các mã quyết định phê duyệt có dùng chuẩn quốc tế Code A (Chấp thuận), Code B (Chấp thuận có lưu ý), Code C (Nộp lại), Code D (Bác bỏ)?                              | Khi Tư vấn giám sát áp dụng bộ mã phê duyệt riêng biệt theo quy định của Chủ đầu tư quốc tế.               |
| **OQ-005** | Quản lý Không phù hợp: Tách riêng NCR (Non-Conformance Report) hay dùng Issue subtype? | Quản lý dưới dạng Finding Subtype (phân loại CAR/NCR) kế thừa từ hệ thống Quản lý Hiện trường với workflow mở rộng.                                       | 1. Sự cố nghiêm trọng mức nào thì phải phát hành biên bản NCR chính thức gửi Chủ đầu tư?<br>2. Quy trình xử lý chi phí khắc phục NCR có liên kết sang thanh toán không? | Khi quy trình QA/QC dự án yêu cầu NCR là một biểu mẫu pháp lý độc lập có đánh số riêng biệt.               |
| **OQ-006** | Mẫu biểu xuất bản nghiệm thu nào bắt buộc phải đúng 100% layout pháp lý?               | Xuất mẫu tiêu chuẩn chung theo Phụ lục Nghị định 207/2026/NĐ-CP và Thông tư 32/2026/TT-BXD; cho phép cấu hình header/logo theo từng dự án.                | 1. Thanh tra xây dựng yêu cầu biên bản in ra phải khớp từng dòng theo mẫu Bộ Xây dựng hay chỉ cần đủ thông tin pháp lý?<br>2. Dự án có biểu mẫu đặc thù riêng không?    | Khi cơ quan quản lý nhà nước kiểm tra yêu cầu định dạng biên bản xuất PDF phải đúng từng mm mẫu quy chuẩn. |
| **OQ-007** | Quy tắc đặt tên bản vẽ, trạng thái phù hợp (Suitability Code) theo ISO 19650?          | Quy ước đặt mã theo ISO 19650: `[Project]-[Originator]-[Volume]-[Level]-[Type]-[Role]-[Number]`; Suitability S0-S4, A1-A4; Cấu hình linh hoạt theo dự án. | 1. Dự án hiện đang dùng quy tắc đặt tên tự do hay tuân thủ chuẩn ISO 19650?<br>2. Cần những trường metadata bắt buộc nào khi tải lên bản vẽ?                            | Dự án không áp dụng ISO 19650 mà sử dụng quy ước mã số tài liệu nội bộ ngắn gọn của Chủ đầu tư.            |

---

## 3. Kế hoạch Triển khai Phỏng vấn & Hoàn tất Hồ sơ

1. **Giai đoạn 1 (Tuần 1-2):** Tiến hành phỏng vấn sâu 5 Giám đốc dự án, 3 Tư vấn trưởng và 4 Kỹ sư hiện trường theo bộ câu hỏi trên.
2. **Giai đoạn 2 (Tuần 3):** Tổng hợp bằng chứng, đối soát với baseline kỹ thuật và đưa ra quyết định xác nhận (Confirm) hoặc tạo Change Request (CR) nếu phát hiện mâu thuẫn nghiệp vụ.
3. **Giai đoạn 3 (Tuần 4):** Trình Hội đồng nghiệm thu Gate C xem xét phê duyệt chính thức trước khi triển khai thử nghiệm thực địa (Pilot).
