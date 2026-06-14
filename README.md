# Field Route Navigator v20 - OSM Smart Route

Bản v20 dựa trên v19 và thêm chế độ **OSM Smart Route**.

## Có gì mới

- Không cần `Route.kmz` trong repo; người dùng tự import KMZ/KML.
- Vẫn dùng KMZ làm danh sách đoạn cần kiểm tra.
- Thêm nút `OSM: Bật/Tắt`.
- Khi `OSM: Bật`, app gọi OSRM/OpenStreetMap để vẽ đường chạy thực tế cho đoạn sắp đi, giúp tránh đi ngược chiều nếu dữ liệu OSM có `oneway`.
- Nếu OSRM lỗi, không có mạng, hoặc khu vực chưa có dữ liệu OSM tốt, app tự fallback về chỉ dẫn theo KMZ.
- Giữ các tính năng từ v19: mũi tên lệch phải `➜`, GPS mượt, số mét còn lại, skip, export GPX.

## Lưu ý quan trọng

- Chế độ OSM cần Internet.
- Public OSRM demo có giới hạn tải; nếu dùng nhiều ngoài thực địa nên tự host OSRM/Valhalla/GraphHopper hoặc dùng dịch vụ routing riêng.
- App chỉ thông minh theo mức độ chính xác của dữ liệu OpenStreetMap. Nếu đường một chiều chưa được cập nhật trên OSM thì app cũng không thể biết chính xác.

## Deploy

Upload đè 4 file lên GitHub:

- `index.html`
- `app.js`
- `styles.css`
- `README.md`

Mở:

```text
https://baolanxix.github.io/Route_ins/?v=20
```
