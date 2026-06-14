# Field Route Navigator v18

Bản v18 sửa theo phản hồi ngoài thực địa:

- Route không còn tự load `Route.kmz`; người dùng tự import KMZ/KML.
- Mũi tên nhỏ có đuôi `➜`, lệch bên phải route theo chiều đi.
- Sửa lỗi v17 quá bảo thủ làm đoạn đã chạy qua không tô xanh:
  - tăng buffer GPS lên 12m cho đường lớn,
  - cho phép xác nhận trong vài segment kế tiếp gần GPS,
  - nhận diện trường hợp xe chạy nhanh qua segment ngắn giữa 2 lần cập nhật GPS.
- Đoạn đã đi rồi nhưng cần chạy lại để tới đoạn chưa đi: chỉ hiện mũi tên, không tô vàng đường nữa.

Mở sau khi deploy:

https://baolanxix.github.io/Route_ins/?v=18
