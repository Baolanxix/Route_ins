# Field Route Navigator v15

Ứng dụng web tĩnh dùng Leaflet để import KMZ/KML và dẫn theo tuyến.

## v15
- Không cần `Route.kmz` trong repo. Mở app rồi bấm **Chọn KMZ/KML** để import route.
- Chỉ vẽ mũi tên ở đoạn đang đi gần nhất để tránh chồng mũi tên khi quay đầu.
- Nếu phát hiện quay đầu trên cùng segment, hiện ký hiệu `↺` thay vì vẽ 2 mũi tên ngược chiều đè nhau.
- Vẫn giữ: chỉ dẫn trước 300m, buffer GPS 8m, chia segment nhỏ, bỏ qua đoạn / bỏ qua 300m, xuất GPX.

Deploy lên GitHub Pages/Vercel như web tĩnh.
