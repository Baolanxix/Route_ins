# Route KMZ Navigator

Web tĩnh để mở file KMZ/KML route, xin vị trí thiết bị, hiển thị bản đồ vệ tinh và chọn chiều đi gần nhất để đi hết tuyến với ít lặp đoạn.

## Cách dùng trên GitHub Pages

1. Tạo repository mới trên GitHub, ví dụ `route-navigator`.
2. Upload toàn bộ các file này lên repo:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `Route.kmz`
3. Vào **Settings → Pages**.
4. Ở **Build and deployment**, chọn:
   - Source: `Deploy from a branch`
   - Branch: `main` / folder `/root`
5. Mở link GitHub Pages dạng:
   `https://<username>.github.io/route-navigator/`

> Lưu ý: định vị chỉ chạy trên HTTPS hoặc localhost. GitHub Pages là HTTPS nên dùng được.

## Thay route khác

- Cách 1: thay file `Route.kmz` trong repo bằng file KMZ mới, giữ nguyên tên.
- Cách 2: mở web rồi bấm **Chọn KMZ/KML khác**.

## Giới hạn hiện tại

- Code tối ưu tốt nhất khi KMZ là một tuyến/LineString hoặc vài đoạn LineString.
- Nếu KMZ là mạng đường phức tạp cần bài toán Chinese Postman đầy đủ, cần thêm backend hoặc thuật toán graph nâng cao.
