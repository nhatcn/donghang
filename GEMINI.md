# Quy tắc phát triển Dự án: Web Đóng Hàng (Tây Cát)

Tài liệu này định nghĩa toàn bộ quy tắc thiết kế, nghiệp vụ, kiến trúc kỹ thuật và phân quyền cho dự án **Web Đóng Hàng**. Mọi tác vụ lập trình và trợ lý AI khi làm việc trên dự án này bắt buộc phải tuân thủ nghiêm ngặt các quy tắc dưới đây.

---

## 1. Quy tắc Thiết kế & Giao diện (UI / UX)

1. **Tuyệt đối KHÔNG dùng màu Gradient:**
   - Luôn sử dụng màu phẳng (Flat Design) hiện đại, tinh gọn.
   - Bảng màu chủ đạo:
     - Xanh lá thương hiệu: `#0C7C3F` (Primary), Hover: `#096332`.
     - Nền: Light mode `#f6f8f7`, Dark mode `#121815`.
     - Thẻ (Card): `#ffffff` / `#1a221e`.
   - Giữ độ tương phản cao, chữ rõ nét, viền thanh mảnh (`1px solid var(--line)`).

2. **Tối ưu Mobile-First (Thân thiện trên điện thoại):**
   - Đội ngũ đóng hàng thao tác chủ yếu trên điện thoại và máy tính bảng trong kho.
   - Menu ngang, thanh lọc (filters, date chips) gọn gàng, không chiếm nhiều không gian dọc.
   - Nút bấm và ô tick kích thước vừa tay:
     - Checkbox sản phẩm (`.chk`): ~`28x28px` (không quá to làm choán màn hình).
     - Checkbox chọn đơn (`.sel-btn`): ~`26x26px`.
   - Ngôn ngữ giao diện: **100% Tiếng Việt**.

---

## 2. Quy tắc Nghiệp vụ Đóng Hàng & Mã Lô

1. **Điều kiện Hoàn tất đơn hàng:**
   - **Bắt buộc phải tick hoàn thành tất cả sản phẩm (100%)** trong đơn mới được phép bấm nút "Hoàn tất đơn".
   - Nếu chưa tick đủ, nút hoàn tất phải ở trạng thái vô hiệu hóa (`disabled`) và hiển thị số lượng còn thiếu (vd: `Tick đủ 5 món để hoàn tất (3/5)`).

2. **Đánh mã lô hàng loạt (Batch Lot):**
   - Cho phép chọn nhiều đơn cùng lúc bằng ô chọn trên thẻ đơn.
   - Gom các sản phẩm trùng tên / trùng SKU giữa các đơn đã chọn để điền mã lô chung 1 lần.
   - **Quy tắc loại trừ:** Bỏ qua tất cả SKU kết thúc bằng `0200` / `0201` hoặc chứa `*0200` / `*0201` (không bắt buộc/không đánh mã lô).
   - **Chỉ áp dụng cho món ĐÃ TICK:** Chỉ điền mã lô cho những sản phẩm **đã được tick hoàn thành** trong các đơn đã chọn (đơn có thể đang làm dở, các món chưa tick còn đợi sản xuất).

3. **Mã lô MIX 8 vị hàng ngày:**
   - Mỗi ngày đều có 1 lần nhập vào trường `MIX` để lưu mã lô cho 8 loại sp trái cây cuộn:
     1. Chuối cuộn hạt điều (ghi tắt: **điều**)
     2. Chuối cuộn đậu phộng (**đậu**)
     3. Chuối cuộn sầu riêng (**SR**)
     4. Chuối cuộn hạt mè (**mè**)
     5. Khóm cuộn (**khóm**)
     6. Me cuộn (**me**)
     7. Mãng cầu cuộn (**MC**)
     8. Xoài cuộn (**xoài**)
   - Dùng để kiểm soát và tự động điền mã lô cho các sản phẩm Mix 8 vị (`TCC8*`).

4. **Tính toán số lượng cần chuẩn bị:**
   - Người đóng hàng có thể chọn các đơn: tính toán số lượng chuẩn bị theo các đơn đã chọn; nếu không chọn đơn nào thì tính trên toàn bộ đơn đang làm (`open`).
   - **Quy tắc gom hàng chuẩn bị (Quy tắc Sá toàn diện):**
     - **Tất cả sản phẩm đều được tạo thành từ 'Sá' ngoại trừ đuôi `0200` / `*0200` / `0201` / `*0201`** (chỉ có các mã này là vật tư, thùng carton, bao bì đóng gói sẵn).
     - **Những mã `TCC8*`** (Trái cây cuộn 8 vị) được chia đều khối lượng cho 8 loại sá chủ lực (điều, đậu, SR, mè, khóm, me, MC, xoài).
     - **Những mã thanh bar 3 vị (`T3V*`)** được chia đều khối lượng cho 3 loại: me cuộn sá, khóm cuộn sá, xoài cuộn muối ớt sá.
     - **Toàn bộ các sản phẩm còn lại (bánh phồng, bánh kẹo, các loại cuộn lẻ, combo...)** đều được chuyển đổi thành tên sá tương ứng (vd: `Xoài cuộn chanh dây sá`, `Bánh phồng kẹp khóm sá`, `Bánh phồng kẹp khóm vị cam sá`, `Bánh phồng kẹp khóm vị khoai môn sá`...) và tính tổng khối lượng (hoặc phần/cái) để nhân viên kho dễ dàng chuẩn bị nguyên liệu xuất kho.
     - Những mã vật tư `0200` / `0201` được gom riêng theo tên sản phẩm và đếm số lượng cái/thùng.

5. **Thời gian hoàn tất (`done_at`):**
   - Mọi đơn khi hoàn tất phải ghi nhận timestamp `done_at = Date.now()`.

6. **Đơn hàng từ OdooBot (Đơn TikTok):**
   - Seller (nhân viên bán hàng / `user_id`) hoặc người tạo đơn (`create_uid`) là `OdooBot` được xác định chính là đơn **TikTok**.
   - **Thông báo đơn TikTok:** Khi có đơn TikTok mới, hệ thống chỉ thông báo: `"Có đơn TikTok mới"` (hoặc `"Đã có đơn TikTok mới"`), **tuyệt đối không đọc/báo tên khách hàng** (do tên khách hàng từ sàn TikTok bị che/mã hóa ký tự sao).

7. **Thời điểm kéo đơn về từ Odoo (Độ trễ 3 phút):**
   - Các đơn hàng được tạo sau 3 phút so với thời điểm hiện tại (`create_date <= now - 3 phút`) mới được phép kéo về hệ thống đóng hàng (tránh kéo đơn dở dang hoặc vừa tạo chưa ổn định từ sàn).

---

## 3. Quy tắc Thông báo & Cảnh báo âm thanh

1. **Khi sang ngày mới:**
   - **Không được thông báo riêng lẻ từng đơn** từ 18h ngày hôm trước đến 7h30 hôm nay (tránh bị thông báo/đọc tên spam khi mở ứng dụng vào đầu ca sáng).
   - **Gộp toàn bộ các đơn đó thành 1 thông báo duy nhất:** `"Có [số lượng] đơn từ 18h hôm qua đến sáng nay"`.
   - **In đỏ các đơn đó lên:** Trên thẻ đơn hàng hiển thị viền đỏ, mã đơn màu đỏ nổi bật và gắn tag `ĐƠN ĐÊM 18H-7H30`.

---

## 4. Quy tắc Phân quyền & Người dùng (Roles & Auth)

Hệ thống chia làm **3 vai trò người dùng** (Quy tắc đăng ký: Người đăng ký mới chỉ có thể là **Người đóng hàng** `packer`, vai trò **Quản lý** `manager` và **Quản trị viên** `admin` không cho phép tự do đăng ký):

### A. Quản Trị Viên (`admin`) - Tài khoản: `admin` / mật khẩu: `1234`
- Có toàn bộ quyền theo dõi và giám sát như Quản lý.
- **Quyền Xóa đơn hàng:** Có nút `🗑️ Xóa đơn hàng` trên thẻ đơn và trong modal chi tiết đơn để xóa vĩnh viễn đơn hàng và các mặt hàng liên quan.
- **Quyền Phân quyền người dùng:** Có nút `👥 Phân quyền` trên thanh công cụ để xem danh sách nhân viên và chuyển đổi vai trò qua lại giữa **Quản lý** (`manager`) và **Người đóng hàng** (`packer`).
- Không bị nhận chuông/TTS đơn mới (tương tự như Quản lý).

### B. Người Quản Lý (`manager`)
- Thấy toàn bộ giao diện theo dõi tiến độ đơn hàng và tổng hợp sản phẩm cần chuẩn bị.
- **KHÔNG nhận thông báo / âm thanh / giọng đọc TTS về đơn mới** (tránh làm phiền người quản lý khi kho nhận đơn).
- **Tính năng Nhắc nhở đơn chưa xong:**
  - Trên các đơn hàng chưa hoàn tất (`open`), có nút `🔔 Nhắc nhở`.
  - Khi quản lý bấm nhắc nhở, hệ thống tạo thông báo gửi tới kho/người đóng hàng theo đúng mẫu:
    > `"[Tên người quản lý] đã nhắc nhở về đơn hàng của khách hàng [Tên khách] ngày [Ngày tạo đơn]"`

### C. Người Đóng Hàng (`packer`)
- Thao tác đóng hàng: tick từng món, nhập mã lô, bấm hoàn tất đơn.
- Nhận thông báo âm thanh + TTS giọng đọc tiếng Việt khi có đơn mới.
- Nhận thông báo âm thanh + TTS khi có nhắc nhở từ người quản lý.
- **Ghi nhận danh tính người đóng:** Khi bấm xác nhận hoàn tất đơn, bắt buộc phải lưu kèm ID và tên người đóng hàng vào bảng đơn hàng (`confirmed_by`, `confirmed_by_name`).

---

## 5. Kiến trúc Kỹ thuật & Cấu trúc Thư mục

- **Backend:** Node.js (ESM `type: "module"`), Express.js.
- **Database:** SQLite tích hợp chuẩn qua `node:sqlite` (`DatabaseSync`), chế độ WAL (`PRAGMA journal_mode=WAL`).
- **Mã hóa & Xác thực:** Sử dụng thư viện chuẩn tích hợp `node:crypto` (`scryptSync`, `randomBytes`, `timingSafeEqual`), không cài thêm thư viện auth nặng nề bên ngoài.
- **Tổ chức file:**
  - `server.js`: Khởi tạo Express, nạp `.env` qua `process.loadEnvFile()`, mount routes, static files.
  - `db.js`: Khởi tạo DB, migrations bảng `orders`, `items`, `users`, `sessions`, `notifications`, các helper queries.
  - `odoo.js`: Kết nối đồng bộ XML-RPC Odoo, hàm động `getOdooConfig()`.
  - `routes/auth.js`: Các endpoint `/api/auth/login`, `/signup`, `/logout`, `/me` và middleware `authMiddleware`.
  - `routes/api.js`: Các API `/api/orders`, `/items`, `/batch-lot`, `/remind`, `/notifications`, `/mix-lot`.
  - `public/`:
    - `index.html`: Bộ khung giao diện đóng hàng chính.
    - `login.html`: Trang đăng nhập và đăng ký tài khoản (không có tài khoản mẫu cố định).
    - `app.js`: Toàn bộ logic frontend vanilla JS, audio, TTS, Web Notification, tính toán chuẩn bị sá 8 vị, modal MIX lot.
    - `style.css`: Toàn bộ CSS giao diện (chỉ dùng flat design, biến CSS, không gradient, định dạng in đỏ đơn đêm).
