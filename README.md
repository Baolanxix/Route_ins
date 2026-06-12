# Field Route Navigator v11

- Bản đồ vệ tinh.
- Chọn/import KMZ hoặc KML khác.
- GPS bắt đầu tại điểm gần nhất trên chính đoạn route, không phải điểm đầu/cuối hay vertex.
- Tính hành trình tối ưu kiểu Chinese Postman để đi qua tất cả đoạn trong KMZ với tổng đường lặp ít nhất có thể.
- Chỉ đi trên các đoạn có trong KMZ, không tự vẽ đường ngoài.
- Vàng: đoạn đang dẫn. Xanh: đoạn đã đi. Cam: đoạn bỏ qua. Xám: chưa đi.
- Nút Bỏ qua đoạn sẽ tính lại đường tối ưu cho các đoạn còn lại.
- Tự lưu trạng thái bằng localStorage.
- Có xuất GPX các đoạn đã đi.
