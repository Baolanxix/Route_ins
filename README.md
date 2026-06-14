# Field Route Navigator v17

Bản này dựa trên v14/v16 và sửa thêm lỗi mũi tên khi phải đi qua lại đoạn đã chạy.

## Thay đổi chính

- Không cần `Route.kmz` trong repo. Người dùng tự bấm **Chọn KMZ/KML** để import route.
- Chỉ dẫn trước 300m.
- GPS lệch trong 8m vẫn tính là đã đi.
- Chia route thành segment nhỏ để tô xanh sớm.
- Mũi tên nhỏ dạng `➜`, đặt lệch bên phải route theo chiều đi để tránh trùng khi quay đầu.
- **Mới v17:** Nếu hành trình tối ưu cần chạy qua đoạn đã xanh để tới đoạn chưa đi, đoạn đó vẫn hiện mũi tên vàng chỉ hướng đi.
- **Mới v17:** Không tự bỏ qua segment đã xanh trong kế hoạch; phải đi qua nó theo GPS rồi mới chuyển bước tiếp theo.

Mở sau khi deploy:

```text
https://baolanxix.github.io/Route_ins/?v=17
```
