# Field Route Navigator v14

Bản v14 thêm Auto Intersection + Snap/Split:

- Tự phát hiện giao cắt thật giữa các line trong KMZ.
- Nếu line A-B liền mạch bị line khác cắt tại D nhưng file KMZ không có điểm D, app tự tạo D và tách A-B thành A-D + D-B.
- Snap sai số nhỏ <= 3m cho các đầu/cuối line bị lệch nhẹ.
- Giữ logic GPS v14: chỉ zoom lần đầu ở mức 16, sau đó pan nhẹ.
- Giữ nút chọn KMZ/KML khác.

Mở sau khi deploy:

https://tienviettel.github.io/Route_ins/?v=13


## v14
- Chỉ dẫn trước 300m.
- Chia route thành segment 25m để tô xanh sớm khi đi qua.
- GPS lệch trong 8m vẫn tính là đã đi.
- Thêm nút Bỏ qua 300m để bỏ qua nhiều segment liên tiếp.
- Giữ auto detect giao điểm + snap 3m từ v13.
