# Tượng Kỳ Việt (Xiangqi Web App) ♟️

Tượng Kỳ Việt là một ứng dụng web chơi, học và phân tích Cờ Tướng hiện đại, tích hợp engine AI mạnh mẽ Pikafish (WebAssembly). Ứng dụng được thiết kế theo chuẩn PWA (Progressive Web App), có thể cài đặt như một app native trên điện thoại/máy tính và hoạt động mượt mà ngay cả khi không có Internet.

![Tượng Kỳ Việt](icons/icon-192.png)

## ✨ Tính năng nổi bật

Ứng dụng sở hữu hàng loạt công cụ chuyên sâu dành cho cả người mới học lẫn kỳ thủ chuyên nghiệp:

### 🤖 AI Engine Đa Nền Tảng (Pikafish WASM)

Tự động nhận diện cấu hình máy tính/điện thoại để chạy bản build tối ưu nhất (Single, Multi-thread, SIMD, Relaxed SIMD).

### 🎮 Đa Dạng Chế Độ Chơi

- **Đấu Vs Bot:** 12 cấp độ khó. AI có 2 phong cách: Tiêu chuẩn (đánh khét lẹt) và Giống người (đánh có xác suất lỗi, có thời gian suy nghĩ giả lập và chặn điểm tồi).
- **Phân tích:** Đánh giá điểm số theo thời gian thực (Centipawns / Mate), hiển thị đa biến (MultiPV).
- **Giải bài tập (Puzzle):** Hàng ngàn bài tập từ cơ bản đến nâng cao (Sát pháp, Cờ tàn, Cờ thế).
- **Luyện nhớ ván:** Luyện đi lại các nhánh khai cuộc/biến hóa theo sách.
- **Cờ mù (Blindfold):** Rèn luyện trí nhớ và khả năng tính toán.

### 📊 Biểu Đồ Phân Tích & Báo Cáo

Chấm điểm từng nước đi (Tốt nhất, Sai lầm, Bại thủ...), vẽ biểu đồ diễn biến ván đấu và sinh bình luận chuyên môn như Chess.com.

### ⚖️ Trọng Tài Luật Cờ (WASM Rule Engine)

Sử dụng Core C++ biên dịch sang WebAssembly để bắt lỗi chính xác 100% luật cờ tướng (Luật 60 nước hòa, Cấm chiếu dài/bắt dài liên tục).

### 📚 Sách Khai Cuộc (Opening Books)

- Hỗ trợ Cloud Book (ChessDB).
- Hỗ trợ Local Book ngoại tuyến qua SQLite WASM (đọc trực tiếp các file `.obk`, `.xqb`, `.pfbook` dung lượng lớn ngay trên trình duyệt).

### 📸 Nhận Diện Hình Ảnh

Chụp ảnh bàn cờ ngoài đời và dùng AI (XiangqiAI API) chuyển thành mã FEN để phân tích.

### 💾 Quản Lý Ván Đấu

Hệ thống thư mục lưu trữ qua IndexedDB, hỗ trợ Import/Export đa định dạng (PGN, XQF, CBR, CHE, UBB, FEN...).

## ⚙️ Yêu cầu hệ thống (Prerequisites)

Dự án này sử dụng `.gitignore` để ẩn thư mục `node_modules` (chứa các thư viện của Node.js) nhằm giảm dung lượng tải về.

Bạn bắt buộc phải cài đặt **Node.js** để phục hồi các thư viện này và khởi chạy máy chủ (Server).

### ❓ Tại sao cần máy chủ Node.js cục bộ mà không chạy file HTML trực tiếp?

- **Bảo mật đa luồng (SharedArrayBuffer):** Trình duyệt hiện đại bắt buộc phải có các Header bảo mật (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) thì mới cho phép AI Pikafish chạy đa luồng. Máy chủ Node.js sinh ra để cấp phép các Header này.
- **CORS Proxy:** Node.js xử lý việc nhận ảnh, nén ảnh và gửi qua API nhận diện hình ảnh, tránh lỗi chặn tên miền (CORS) của trình duyệt.

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### Bước 1: Tải mã nguồn về máy

Bạn có thể clone dự án bằng Git hoặc tải file `.zip` từ GitHub và giải nén.

```bash
git clone https://github.com/SuperEasyGame/TuongKyViet.git
```

### Bước 2: Cài đặt Node.js

Nếu máy tính của bạn chưa có Node.js, hãy làm theo các bước sau:

1. Truy cập trang chủ: <https://nodejs.org/>
2. Tải và cài đặt phiên bản LTS (Long Term Support).
3. Sau khi cài đặt xong, mở Command Prompt (cmd) hoặc Terminal và gõ lệnh sau để kiểm tra:

   ```bash
   node -v
   npm -v
   ```

   Nếu màn hình in ra phiên bản dạng `v18.x.x` hoặc `v20.x.x` là thành công.

### Bước 3: Cài đặt các thư viện phụ thuộc (Dependencies)

Mở Terminal/Command Prompt, di chuyển đường dẫn (`cd`) vào thư mục mã nguồn dự án mà bạn vừa tải về, sau đó chạy lệnh:

```bash
npm install
```

Lệnh này sẽ tự động đọc file `package.json` và tải về thư mục `node_modules` cùng các thư viện cần thiết (`express`, `multer`, `cors`...).

### Bước 4: Khởi chạy máy chủ (Run the Server)

Vẫn tại thư mục dự án, chạy lệnh:

```bash
npm start
```

Hoặc bạn cũng có thể chạy lệnh:

```bash
node server.js
```

Nếu Terminal hiển thị dòng chữ:

```text
✅ Máy chủ đã chạy thành công!
🎮 Truy cập: http://localhost:3000
```

Tức là dự án đã hoạt động!

### Bước 5: Trải nghiệm ứng dụng

Mở trình duyệt web (Chrome, Edge, Cốc Cốc, Safari...) và truy cập vào địa chỉ:

👉 <http://localhost:3000>

## 📂 Cấu trúc thư mục chính

- `index.html`: Giao diện chính của ứng dụng.
- `server.js`: Mã nguồn máy chủ Node.js (xử lý cấu hình Header và API Proxy).
- `js/`: Thư mục chứa toàn bộ logic ứng dụng (State, UI, Game, Analyzer, Database, Chart...).
- `rules/`: File C++ biên dịch sang WebAssembly (`xiangqi_rule.wasm`) đảm nhiệm vai trò trọng tài bắt lỗi luật cờ.
- `engines/`: Các bản build của Engine AI Pikafish (Single, Multi, SIMD...).
- `sql/`: Thư viện `sql-wasm` dùng để đọc các file Local Book ngay trên trình duyệt.
- `data/`: Dữ liệu bài tập cờ tàn, sát pháp, khai cuộc dạng `.json`.
- `style/`: CSS, hình ảnh quân cờ/bàn cờ và icon đánh giá nước đi.
- `vschess/`: Thư viện xử lý FEN và tọa độ cờ tướng.

## 📝 Giấy phép & Tri ân (Credits)

Dự án được cung cấp dưới dạng mã nguồn mở. Ứng dụng sẽ không thể hoàn thiện nếu thiếu đi sự cống hiến từ các dự án mã nguồn mở sau:

- **Pikafish:** Engine Cờ Tướng cực mạnh — <https://github.com/official-pikafish/Pikafish>
- **Vschess:** Thư viện thao tác FEN, PGN, XQF — <https://github.com/FastLight126/vschess>
- **Sql.js:** Thư viện SQLite cho WebAssembly — <https://github.com/sql-js/sql.js>
- **XiangqiAI:** API hỗ trợ nhận diện hình ảnh bàn cờ — <https://xiangqiai.com>
