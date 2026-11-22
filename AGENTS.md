# Quy tắc phát triển Dự án: Web Đóng Hàng (Tây Cát)

Toàn bộ quy tắc cốt lõi của dự án được định nghĩa chi tiết tại file [GEMINI.md](./GEMINI.md).

Vui lòng tham khảo và tuân thủ các quy tắc trong [GEMINI.md](./GEMINI.md) bao gồm:
1. **Thiết kế & Giao diện:** Flat design, tuyệt đối KHÔNG gradient, tối ưu mobile-first, kích thước checkbox vừa vặn (~28px), 100% tiếng Việt.
2. **Nghiệp vụ Đóng Hàng:**
   - Phải tick đủ 100% món mới được hoàn tất đơn.
   - Đánh mã lô hàng loạt: loại trừ SKU đuôi `0200` / `*0200`/`0201` / `*0201`, chỉ điền cho các món ĐÃ ĐƯỢC TICK.
   - Ghi nhận `done_at` và hiển thị thời gian hoàn tất rõ ràng trên thẻ đơn & modal.
   - Seller hoặc người tạo đơn là OdooBot chính là đơn TikTok. Khi thông báo đơn TikTok chỉ cần báo "Có đơn TikTok mới", tuyệt đối không đọc tên khách hàng.
   - Các đơn được tạo sau 3 phút so với hiện tại mới được phép kéo về từ Odoo. 
   - Mỗi ngày đều có 1 lần nhập vào trường `MIX` để lưu mã lô cho các loại sp trái cây cuộn 8 vị: Chuối cuộn hạt điều(ghi tắt là điều), chuối cuộn đậu phộng(đậu), chuối cuộn sầu riêng(SR), chuối cuộn hạt mè(mè), khóm cuộn(khóm), me cuộn(me), mãng cầu cuộn(MC), xoài cuộn(xoài)
   
   - Người đóng hàng có thể chọn các đơn hoặc để mặc định toàn bộ đơn đang làm để tính toán số lượng cần chuẩn bị: Tất cả sản phẩm đều được tạo thành từ 'Sá' ngoại trừ đuôi `0200` / `*0200` / `0201` / `*0201`. Những mã `TCC8*` chia đều khối lượng cho 8 loại sá; thanh bar 3 vị `T3V*` chia đều 3 loại (me, khóm, xoài muối ớt); toàn bộ các món khác (bánh phồng kẹp khóm, xoài cuộn chanh dây, bánh phồng các vị...) được quy đổi thành tên sá tương ứng + khối lượng/phần để kho chuẩn bị. Chỉ có mã `0200` / `0201` (thùng carton, vật tư) là gom riêng theo tên sản phẩm.

3. **Phân quyền 3 vai trò & Đăng ký:**
   - Người đăng ký mới chỉ có thể là người đóng hàng (`packer`). Vai trò quản lý (`manager`) và quản trị viên (`admin`) không cho phép đăng ký tự do.
   - `admin`: Tài khoản `admin / 1234`, toàn quyền quản trị, có thể xóa đơn hàng và phân quyền thay đổi role cho người khác (`manager` hoặc `packer`).
   - `manager`: Giám sát, KHÔNG nhận chuông/TTS đơn mới, có nút `🔔 Nhắc nhở` đơn chưa xong (`[tên QL] đã nhắc nhở về đơn hàng của khách hàng... ngày...`).
   - `packer`: Đóng hàng, nhận chuông/TTS đơn mới và nhắc nhở; khi hoàn tất đơn bắt buộc lưu kèm người đóng (`confirmed_by`, `confirmed_by_name`).
4. **Cấu trúc & Kỹ thuật:** Node.js ESM, Express, `node:sqlite`, `node:crypto`, phân tách file module rõ ràng (`server.js`, `db.js`, `odoo.js`, `routes/`, `public/`).
5. **Về thông báo:**
   - Khi sang ngày mới không được thông báo các đơn từ 18h ngày hôm trước đến 7h30 hôm nay (vì mở phần mềm lên sẽ bị thông báo spam), gộp các thông báo đó thành 1 thông báo và in đỏ các đơn đó lên (ghi là "Có [số lượng] đơn từ 18h hôm qua đến sáng nay").
   - Đơn TikTok chỉ thông báo "Có đơn TikTok mới", không kèm tên khách hàng.
