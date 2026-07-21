Hãy đóng vai một Lập trình viên Senior (Electron + GIS Developer). Tôi muốn bạn thiết kế và viết mã nguồn cho một ứng dụng Desktop bằng Electron.js có chức năng: Triển khai thử đất, giải đoán tọa độ từ ảnh (OCR), biên tập bản vẽ và xuất dữ liệu chuẩn hệ tọa độ VN-2000.

---

### 1. TỔNG QUAN ỨNG DỤNG (OVERVIEW)
* **Tên dự án:** VN-LandEditor (Desktop App)
* **Nền tảng:** Electron + React (hoặc Vanilla JS + HTML5 Canvas/SVG)
* **Mục tiêu:** 
  1. Cho phép nhập thủ công các cặp tọa độ (X, Y) hoặc upload file ảnh sổ đỏ/sổ hồng để tự động trích xuất bảng tọa độ bằng OCR.
  2. Quy đổi/Hiển thị dữ liệu trên bản vẽ đồ họa tương tác.
  3. Cho phép biên tập, chỉnh sửa thửa đất (thêm/xóa/sửa đỉnh, đo cạnh, đo góc, gắn nhãn thông tin thửa đất).
  4. Xuất file kết quả dưới dạng JSON chuẩn chứa tọa độ VN-2000 đã biên tập.

---

### 2. YÊU CẦU KỸ THUẬT VÀ LÕI TÍNH TOÁN (TECHNICAL SPECS & GIS)

#### A. Hệ tọa độ VN-2000 (Vietnam 2000)
Ứng dụng phải hỗ trợ chuyển đổi/xử lý chính xác hệ tọa độ VN-2000 cho các khu vực chính:
* **Hồ Chí Minh:** Kinh tuyến trục $105^\circ 45'$, múi chiếu $3^\circ$ (Scale factor: 0.9999).
* **Bình Dương:** Kinh tuyến trục $105^\circ 45'$, múi chiếu $3^\circ$.
* **Bà Rịa - Vũng Tàu:** Kinh tuyến trục $107^\circ 00'$, múi chiếu $3^\circ$.
* *(Sử dụng thư viện `proj4js` để xử lý tham số WGS84 - VN2000 tương ứng).*

#### B. Đọc và Nhận dạng ảnh (OCR)
* Tích hợp thư viện **Tesseract.js** (hoặc tích hợp Google Vision API / EasyOCR tùy chọn).
* Tiền xử lý ảnh (Image Pre-processing) trước khi OCR: Grayscale, binarization (ngưỡng nhị phân), tăng tương phản để nâng cao độ chính xác khi đọc bảng tọa độ trên Giấy chứng nhận quyền sử dụng đất.
* Regex parser thông minh để lọc các dòng chứa thông tin Điểm, X, Y (ví dụ dạng `1 | 1192345.12 | 601234.56`).

#### C. Trình biên tập Bản vẽ (Canvas/Vector Editor)
* Sử dụng **Paper.js**, **Fabric.js** hoặc **Leaflet/OpenLayers** (custom layer).
* Tính năng vẽ:
  - Tự động vẽ đa giác (Polygon) khép kín từ danh sách tọa độ nhập vào.
  - Hiển thị nhãn tên điểm ($1, 2, 3...$) và chiều dài từng cạnh ($m$).
  - Cho phép Kéo - Thả (Drag & Drop) đỉnh để điều chỉnh vị trí.
  - Thêm đỉnh mới trên cạnh / Xóa đỉnh.
  - Công cụ thước đo khoảng cách, đo diện tích thửa đất ($m^2$).
  - Pan / Zoom mượt mà.

---

### 3. LUỒNG HOẠT ĐỘNG VÀ GIAO DIỆN (WORKFLOW & UI)

Giao diện chia làm 3 vùng chính:
1. **Sidebar Trái (Nhập liệu & OCR):**
   - Selector chọn Khu vực/Tỉnh thành (Sài Gòn, Bình Dương, Vũng Tàu) để set Kinh tuyến trục.
   - Tab 1: Nhập bảng tọa độ thủ công (Bảng gồm cột: Điểm, X, Y).
   - Tab 2: Upload/Chụp ảnh bảng tọa độ -> Nút "Quét OCR" -> Đổ kết quả vào Bảng tọa độ (cho phép sửa tay lại).
   - Nút "Vẽ thửa đất".

2. **Màn hình chính (Canvas Area):**
   - Hiển thị bản vẽ hình học thửa đất dựa trên tọa độ VN-2000.
   - Thanh công cụ (Toolbar) trên Canvas: Con trỏ (Select/Edit), Thêm điểm, Xóa điểm, Đo kích thước, Reset Zoom.

3. **Sidebar Phải (Thông tin & Xuất file):**
   - Hiển thị bảng thuộc tính: Diện tích ($m^2$), Chu vi ($m$), Tỉnh/Thành phố chọn.
   - Nút "Export JSON" xuất ra cấu trúc file lưu giữ thông tin thửa đất.

---

### 4. CẤU TRÚC FILE JSON ĐẦU RA (OUTPUT FORMAT)
Hãy đảm bảo file JSON xuất ra tuân theo cấu trúc chuẩn sau:
```json
{
  "metadata": {
    "province": "TP.HCM",
    "meridian": 105.75,
    "sothuadat": 10,
    "sotobando": 15,
    "maloaidat": ODT,
    "dientich": 100,
    "zone": "3_degree",
    "created_at": "2026-07-21T20:30:00Z"
  },
  "parcel_info": {
    "area_m2": 125.4,
    "perimeter_m": 48.2
  },
  "coordinates": [
    {"point": "1", "x": 1192345.12, "y": 601234.56},
    {"point": "2", "x": 1192350.20, "y": 601240.10},
    {"point": "3", "x": 1192340.00, "y": 601245.00},
    {"point": "4", "x": 1192335.50, "y": 601238.80}
  ]
}