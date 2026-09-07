# Quy chế Thu thập, Xử lý và Bảo mật Thông tin Vị trí GPS & EXIF Hiện trường

**Dự án:** Nền tảng Điều hành Xây dựng VinOps  
**Mã văn bản:** POL-SEC-GPS-001  
**Phiên bản:** 1.0 (Gate C / Pilot Baseline)  
**Phạm vi:** Toàn bộ ứng dụng Web, Capacitor Mobile/Tablet, API và Worker lưu trữ

---

## 1. Căn cứ Pháp lý & Tiêu chuẩn Tuân thủ

Quy chế này được xây dựng nhằm đảm bảo tính hợp pháp, toàn vẹn chứng cứ kỹ thuật và bảo vệ quyền riêng tư cá nhân theo hệ thống pháp luật Việt Nam:

1. **Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15** (có hiệu lực từ ngày 01/01/2026): Quy định về quyền của chủ thể dữ liệu, nghĩa vụ của bên kiểm soát/xử lý dữ liệu cá nhân, và các biện pháp bảo vệ dữ liệu nhạy cảm (bao gồm dữ liệu vị trí địa lý cá nhân).
2. **Nghị định 356/2025/NĐ-CP**: Quy định chi tiết thi hành Luật Bảo vệ dữ liệu cá nhân về đánh giá tác động xử lý dữ liệu cá nhân (DPIA) và lưu trữ dữ liệu an toàn.
3. **Luật An ninh mạng 116/2025/QH15**: Quy định về bảo đảm an toàn hệ thống thông tin, lưu trữ dữ liệu tại Việt Nam và ngăn chặn truy cập trái phép.
4. **Nghị định 207/2026/NĐ-CP**: Quy định về quản lý chất lượng thi công xây dựng, nhật ký thi công điện tử, biên bản nghiệm thu và chứng cứ hình ảnh đối soát hiện trường.
5. **Luật Giao dịch điện tử 20/2023/QH15 & Nghị định 23/2025/NĐ-CP**: Quy định về giá trị pháp lý của thông điệp dữ liệu, chứng cứ điện tử, chữ ký điện tử và dịch vụ tin cậy.

---

## 2. Phân loại Dữ liệu & Nguyên tắc Thu thập Tối thiểu

Hệ thống VinOps chỉ thu thập các trường dữ liệu thực sự cần thiết phục vụ nghiệm thu kỹ thuật và giám sát công trình (Nguyên tắc Data Minimization):

### 2.1. Dữ liệu Vị trí Địa lý (GPS Telemetry)

- **Các trường thu thập:** Vĩ độ (Latitude), Kinh độ (Longitude), Bán kính sai số (Accuracy tính bằng mét), Thời điểm ghi nhận (Timestamp UTC).
- **Mục đích duy nhất:**
  - Xác thực người dùng thực sự có mặt tại công trường khi ký biên bản nghiệm thu công việc hoặc lập Nhật ký thi công theo quy định tại Điều 13, 14 Nghị định 207/2026/NĐ-CP.
  - Tự động crawl dữ liệu thời tiết (nhiệt độ, lượng mưa, gió) phục vụ đánh giá điều kiện thời tiết thi công của ngày lập nhật ký.
  - Định vị chính xác vị trí phát sinh sự cố chất lượng (Field Issue) trên mặt bằng công trình.
- **Cam kết cấm:** Nghiêm cấm tuyệt đối việc theo dõi hành trình di chuyển liên tục (Continuous Tracking) của nhân sự ngoài giờ làm việc hoặc ngoài ranh giới dự án. GPS chỉ được kích hoạt một lần duy nhất tại thời điểm bấm nút hành động (Event-triggered GPS).

### 2.2. Siêu dữ liệu Hình ảnh Hiện trường (EXIF Metadata)

- **Các trường được giữ lại:** Ngày giờ chụp (DateTimeOriginal), Tọa độ chụp (GPSLatitude, GPSLongitude), Hướng chụp (GPSImgDirection).
- **Các trường bắt buộc phải bóc tách và loại bỏ (EXIF Sanitization):**
  - Tên chủ sở hữu thiết bị, nhãn người dùng (Camera Owner Name, User Comment chứa PII).
  - Mã nhận dạng phần cứng thiết bị (Device Serial Number, Lens Serial Number).
  - Thông tin nhận dạng mạng (WiFi SSID, BSSID, địa chỉ IP mạng nội bộ của thiết bị).
  - Dữ liệu nhận diện khuôn mặt tự động của camera máy ảnh (Face Recognition / Subject Area tags).

---

## 3. Quy trình Xử lý Kỹ thuật & Kiểm soát An toàn

### 3.1. Xử lý và Bóc tách Siêu dữ liệu tại Worker (EXIF Stripping Pipeline)

1. Khi ảnh hiện trường được tải lên từ ứng dụng Web hoặc Mobile, tệp được lưu tạm thời tại vùng cách ly (Quarantine Object Storage).
2. Worker bất đồng bộ tiến hành:
   - Quét mã độc thông qua ClamAV.
   - Trích xuất tọa độ GPS và thời gian chụp lưu vào bảng cơ sở dữ liệu `vinops.field_issue_attachments` hoặc `vinops.daily_log_weather`.
   - Sử dụng thư viện chuyên dụng loại bỏ toàn bộ các thẻ EXIF nhạy cảm mang thông tin cá nhân.
   - Chuyển tệp ảnh đã làm sạch sang kho lưu trữ chính thức (Business Bucket) và tính toán mã băm SHA-256 bất biến.

### 3.2. Lưu trữ Ngoại tuyến trên Thiết bị Di động (Mobile Offline Storage)

1. Trong điều kiện mất sóng công trường (Offline mode theo ADR-007), dữ liệu GPS và ảnh chụp được lưu trong bộ nhớ an toàn (Sandboxed App Storage) của thiết bị.
2. Dữ liệu ngoại tuyến được mã hóa bằng khóa bảo mật cục bộ của thiết bị di động (Capacitor Secure Storage / Keystore / Keychain).
3. Sau khi thiết bị kết nối mạng trở lại và tác vụ đồng bộ (`flushSyncQueue`) thành công lên máy chủ, bộ nhớ tạm thời trên thiết bị được tự động dọn dẹp và xóa an toàn.

### 3.3. Mã hóa & Bảo vệ Truyền nhận

- **Đường truyền (In-Transit):** Toàn bộ dữ liệu vị trí và hình ảnh truyền tải giữa Mobile/Browser và API bắt buộc sử dụng giao thức TLS 1.3 với cipher suite an toàn cao; cấm fallback về các phiên bản TLS cũ hoặc HTTP không mã hóa.
- **Lưu trữ (At-Rest):** Cơ sở dữ liệu PostgreSQL lưu trữ tọa độ GPS và MinIO/S3 Object Storage lưu trữ ảnh hiện trường bắt buộc kích hoạt mã hóa ổ đĩa cấp hệ thống (Server-Side Encryption AES-256).

---

## 4. Phân quyền Truy cập (RBAC) & Kiểm toán Bất biến (Audit Trail)

1. **Phân quyền truy cập theo vai trò:**
   - **Chỉ huy trưởng, TVGS, BQLDA dự án:** Được phép xem tọa độ GPS và ảnh hiện trường của dự án được phân công.
   - **Nhà thầu phụ / Kỹ sư:** Chỉ được xem dữ liệu thuộc phạm vi gói thầu của mình.
   - **Nghiêm cấm chia sẻ:** Không chia sẻ dữ liệu vị trí cho bất kỳ bên thứ ba nào nằm ngoài hợp đồng thi công và giám sát dự án, trừ trường hợp có yêu cầu bằng văn bản của cơ quan điều tra/thanh tra nhà nước có thẩm quyền.
2. **Nhật ký Kiểm toán (Immutable Audit Trail):**
   - Mọi thao tác ghi nhận, trích xuất, hoặc tải về dữ liệu có chứa thông tin GPS/EXIF đều được tự động ghi nhận vào bảng `vinops.audit_logs`.
   - Nhật ký kiểm toán bao gồm: ID người thực hiện, địa chỉ IP, User-Agent, thời điểm thao tác và mã thực thể liên quan. Nhật ký kiểm toán được bảo vệ chống xóa sửa (Append-only).

---

## 5. Thời hạn Lưu trữ & Quyền của Chủ thể Dữ liệu

### 5.1. Thời hạn Lưu trữ (Data Retention)

- Theo quy định tại Điều 26 Nghị định 207/2026/NĐ-CP và Luật Xây dựng, hồ sơ chất lượng công trình (bao gồm Nhật ký thi công và Biên bản nghiệm thu có gắn tọa độ GPS) phải được lưu trữ tối thiểu bằng thời gian sử dụng công trình (10 năm đến 50 năm tùy cấp công trình).
- Sau khi hết thời hạn lưu trữ pháp lý hoặc dự án hoàn thành bàn giao đầy đủ theo hợp đồng, dữ liệu hình ảnh phụ trợ không nằm trong danh mục lưu trữ bắt buộc sẽ được tiêu hủy an toàn (Secure Wipe) theo quy trình đã phê duyệt.

### 5.2. Quyền của Chủ thể Dữ liệu (Người lao động / Kỹ sư hiện trường)

Theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15, nhân sự sử dụng ứng dụng có các quyền:

1. **Quyền được biết:** Được thông báo rõ ràng về việc ứng dụng chỉ thu thập GPS tại thời điểm ký/lập biên bản nhằm phục vụ nghĩa vụ pháp lý công trình.
2. **Quyền tra cứu:** Xem lại các dữ liệu định vị gắn liền với các tài liệu do chính mình tạo lập.
3. **Quyền khiếu nại:** Khiếu nại lên Bộ phận An toàn Thông tin VinOps nếu phát hiện ứng dụng kích hoạt định vị ngầm khi không có thao tác của người dùng.

---

## 6. Điều khoản Thi hành

1. Quy chế này có hiệu lực kể từ ngày ký và áp dụng bắt buộc cho toàn bộ đội ngũ phát triển, kiểm thử, vận hành và khách hàng tham gia giai đoạn Pilot của VinOps.
2. Mọi sửa đổi, bổ sung quy chế phải thông qua phê duyệt của Trưởng ban Pháp chế và Giám đốc Kỹ thuật VinOps.
