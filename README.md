# Field Route Navigator v15

Bản chỉnh theo v14, nhưng:

- Không cần `Route.kmz` trong repo. Mở app rồi bấm **Chọn KMZ/KML** để import route.
- Mũi tên chỉ đường đổi sang dạng nhỏ có đuôi `➜`.
- Mũi tên được đặt lệch sang **bên phải của route theo chiều đi**, giúp các đoạn quay đầu/đi ngược chiều không bị chồng mũi tên lên nhau.
- Giữ logic v14: chỉ dẫn trước 300m, GPS lệch trong 8m vẫn tính đã đi, chia route nhỏ để đi tới đâu xanh tới đó, có bỏ qua đoạn và bỏ qua 300m.

Mở sau khi deploy:

```text
https://<user>.github.io/Route_ins/?v=15
```
