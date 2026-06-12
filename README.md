# Field Route Navigator v12

- Bản đồ vệ tinh.
- Chọn/import KMZ hoặc KML khác.
- GPS bắt đầu tại điểm gần nhất trên chính đoạn route.
- Tính hành trình tối ưu kiểu Chinese Postman để đi qua tất cả đoạn trong KMZ với tổng đường lặp ít nhất có thể.
- Chỉ đi trên các đoạn có trong KMZ, không tự vẽ đường ngoài.
- Vàng: đoạn đang dẫn. Xanh: đoạn đã đi. Cam: đoạn bỏ qua. Xám: chưa đi.
- Nút Bỏ qua đoạn sẽ tính lại đường tối ưu cho các đoạn còn lại.
- Tự lưu trạng thái bằng localStorage.
- Có xuất GPX các đoạn đã đi.
- v12: bản đồ chỉ zoom 1 lần ở mức 16 khi lấy GPS đầu tiên; các lần cập nhật GPS sau chỉ pan theo vị trí, không phóng to liên tục.
