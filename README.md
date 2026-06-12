# Field Route Navigator v13

Bản v13 thêm Auto Intersection + Snap/Split:

- Tự phát hiện giao cắt thật giữa các line trong KMZ.
- Nếu line A-B liền mạch bị line khác cắt tại D nhưng file KMZ không có điểm D, app tự tạo D và tách A-B thành A-D + D-B.
- Snap sai số nhỏ <= 3m cho các đầu/cuối line bị lệch nhẹ.
- Giữ logic GPS v12: chỉ zoom lần đầu ở mức 16, sau đó pan nhẹ.
- Giữ nút chọn KMZ/KML khác.

Mở sau khi deploy:

https://tienviettel.github.io/Route_ins/?v=13
