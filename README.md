# Web đóng hàng (Odoo → tablet/điện thoại)

Web tự hỏi Odoo mỗi 60 giây, lấy các **báo giá** mới (kể cả Shopee, TikTok) về danh sách đóng hàng.
Khi nhân viên bấm **Xác nhận** (hoặc **Hủy**) báo giá trong Odoo, đơn tự rời khỏi danh sách "Đang làm".

## Tính năng mới (v2.1)
- Hiển thị số điện thoại khách (bấm gọi được)
- Hiển thị tổng tiền đơn hàng
- Hiển thị địa chỉ + người bán
- Giao diện tối ưu hơn cho điện thoại

## Cách hoạt động
- Lấy `sale.order` có trạng thái Báo giá (`draft`) và Báo giá đã gửi (`sent`), kèm dòng sản phẩm.
- Bỏ các dòng dịch vụ (phí ship...) và dòng số lượng 0.
- Nhận biết nguồn: tên khách/ghi chú/nhóm bán hàng có chữ "shopee" → Shopee, "tiktok" → TikTok, còn lại → Khác.
- Báo giá sửa trong Odoo (thêm/bớt dòng, đổi số lượng): web tự cập nhật, giữ nguyên tick và mã lô đã nhập.
- Cột "Cần chuẩn bị" gộp theo **tên sản phẩm**, chỉ tính món chưa tick của các đơn đang làm.
- Nút **Cập nhật** trên web hỏi Odoo ngay, không cần chờ 60 giây.

## Chạy thử trên máy (cần Node 22.13 trở lên)
```bash
cp .env.example .env      # rồi điền thông tin Odoo
npm install
npm run dev               # mở http://localhost:3000