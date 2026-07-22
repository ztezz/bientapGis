# VN-LandEditor

Ứng dụng desktop hỗ trợ nhập, hiển thị và biên tập thửa đất trong hệ tọa độ
VN-2000. Dự án được xây dựng bằng Electron, React, Vite và Fabric.js.

## Tính năng chính

- Nhập bảng tọa độ thửa đất thủ công.
- Nhận dạng bảng tọa độ từ ảnh bằng Tesseract.js OCR.
- Hiển thị và biên tập polygon trên canvas.
- Thêm, xóa, kéo thả và bắt điểm đỉnh.
- Đo khoảng cách, diện tích và chu vi.
- Quản lý nhiều layer, ẩn/hiện, khóa và điều chỉnh độ trong suốt.
- Nhóm layer theo từng file DWG trong cây thư mục có thể thu gọn/mở rộng.
- Undo/redo và tự động lưu dữ liệu phù hợp vào `localStorage`.
- Chuyển đổi tọa độ VN-2000 bằng Proj4.
- Nhập JSON, GeoJSON, CSV, DXF ASCII và DWG.
- Mở DWG offline bằng LibreDWG WebAssembly, không yêu cầu AutoCAD.
- Xuất dữ liệu dự án để lưu trữ hoặc tiếp tục biên tập.

## Công nghệ

- Electron 32
- React 18
- Vite 5
- Fabric.js 5
- Leaflet
- Proj4
- Tesseract.js
- LibreDWG WebAssembly

## Yêu cầu môi trường

- Node.js 18 trở lên.
- npm.
- Windows, Linux hoặc macOS. Quy trình hiện tại được kiểm tra chủ yếu trên
  Windows.

## Cài đặt

```powershell
git clone <repository-url>
cd bientapGis
npm.cmd install
```

PowerShell trên Windows có thể chặn `npm.ps1`. Khi đó, sử dụng `npm.cmd` như
các ví dụ trong tài liệu này.

## Chạy môi trường phát triển

```powershell
npm.cmd run dev
```

Lệnh trên khởi động Vite tại `http://localhost:5173` và mở ứng dụng Electron.

## Build

Trên Windows, nhấp đúp `build.bat` để tạo bản portable dạng thư mục. Có thể
chạy từ Command Prompt để tạo bộ cài NSIS:

```bat
build.bat installer
```

Không truyền tham số sẽ tạo executable tại
`dist-electron\win-unpacked\VN-LandEditor.exe`.

Chỉ build giao diện renderer:

```powershell
npm.cmd run build:renderer
```

Build và đóng gói ứng dụng:

```powershell
npm.cmd run build
```

Sản phẩm đóng gói được tạo trong thư mục `dist-electron`.

Nếu Windows không cho phép `electron-builder` tạo symbolic link cho công cụ
ký executable, có thể tạo bản portable dạng thư mục bằng lệnh:

```powershell
npx.cmd electron-builder --dir --config.win.signAndEditExecutable=false
```

Executable được tạo tại:

```text
dist-electron\win-unpacked\VN-LandEditor.exe
```

Nếu build báo `Access is denied`, hãy đóng các tiến trình VN-LandEditor hoặc
Electron đang sử dụng file trong `dist-electron\win-unpacked` rồi build lại.

## Quy ước tọa độ

VN-LandEditor lưu tọa độ VN-2000 theo quy ước:

```text
x = Northing
y = Easting
```

AutoCAD sử dụng:

```text
X = Easting
Y = Northing
```

Khi nhập dữ liệu CAD, ứng dụng chuyển đổi như sau:

```text
VN-2000 x = CAD Y
VN-2000 y = CAD X
```

Không nên đảo hai trục khi chuẩn bị dữ liệu đầu vào.

## Nhập DXF và DWG

### DXF

Ứng dụng hiện đọc DXF ASCII và giữ lại tên layer CAD. Các polyline khép kín
có thể được sử dụng làm vùng; đường hở chỉ được dùng làm dữ liệu tham chiếu.
DXF binary chưa được hỗ trợ.

### DWG

DWG được đọc offline bằng `@mlightcad/libredwg-web`. Các đối tượng CAD được
nhập thành layer tham chiếu để hiển thị và bắt điểm, không tự động trở thành
thửa đất.

Nếu DWG chứa Xref chưa được Bind, file chính không có hình học của bản vẽ tham
chiếu nên ứng dụng sẽ cảnh báo tên Xref bị thiếu. Cần mở file trong AutoCAD,
Bind Xref và lưu lại thành một DWG đầy đủ trước khi nhập.

Các entity đang được hỗ trợ gồm:

- `LINE`
- `ARC`
- `CIRCLE`
- `ELLIPSE`
- `LWPOLYLINE`
- `POLYLINE2D`
- Biên ngoài `HATCH`
- `TEXT`, `MTEXT`, `ATTRIB`
- `INSERT` và block lồng nhau

Các cung tròn, đường tròn, ellipse, bulge và cung trong HATCH được nội suy với
bước góc tối đa 30 độ. Mật độ này ưu tiên hiệu năng hiển thị và bắt điểm hơn
việc mô phỏng đường cong CAD bằng quá nhiều điểm trung gian.

Sau khi nhập DWG, có thể vẽ thửa mới trên layer `Vùng tạo từ DWG` và sử dụng
bắt điểm trên các layer CAD đang hiển thị.

Mỗi file DWG được hiển thị thành một thư mục riêng trong bảng quản lý lớp.
Nhấn vào tên file để mở hoặc thu gọn toàn bộ layer thuộc bản vẽ đó.
Các nút thao tác nhanh trên thư mục cho phép hiện tất cả, ẩn tất cả, đảo trạng
thái hiển thị, khóa hoặc mở khóa đồng loạt các layer thuộc file.

Nút `Tạo vùng` trên thư mục DWG chuyển các `LWPOLYLINE`, `POLYLINE2D` và biên
`HATCH` khép kín thành thửa trong layer `Vùng tạo từ DWG`. Circle và ellipse
không được tự chuyển để tránh biến ký hiệu CAD thành thửa. Có thể Undo toàn bộ
lượt tạo; nhấn lại sẽ bỏ qua những vùng có hình học trùng nhau.

## Biên tập CAD

Mở khóa layer CAD trước khi sửa, sau đó sử dụng nhóm công cụ `CAD`:

| Phím | Công cụ CAD |
| --- | --- |
| `C` | Chọn nét hoặc chữ CAD |
| `J` | Kéo sửa đỉnh CAD |
| `K` | Di chuyển nét hoặc chữ CAD |
| `I` | Thêm đỉnh vào cạnh CAD |
| `O` | Xóa đỉnh CAD |

Khi chọn chữ CAD, tab `CAD` bên phải cho phép sửa nội dung, tọa độ X/Y, cỡ
chữ, góc xoay và tỷ lệ ngang. Phím `Delete` hoặc nút trong tab CAD xóa đối
tượng đang chọn. Các thao tác hỗ trợ Undo/Redo.

Biên tập CAD thay đổi dữ liệu tham chiếu trong project hiện tại, không ghi đè
file `.dwg` gốc. Reference layer lớn không autosave vào `localStorage`; cần
`Xuất project JSON` để giữ chỉnh sửa CAD và nhập lại project khi cần.

## Phím tắt công cụ

| Phím | Công cụ |
| --- | --- |
| `V` | Chọn vùng |
| `B` | Quét chọn nhiều vùng |
| `D` | Vẽ vùng |
| `S` | Sửa đỉnh |
| `G` | Di chuyển vùng |
| `A` | Thêm đỉnh |
| `X` | Xóa đỉnh |
| `M` | Đo khoảng cách |
| `H` | Pan canvas |
| `N` | Bật/tắt bắt điểm |

## Cấu trúc dự án

```text
src/
  main/
    main.js             Electron main process và IPC
    preload.js          API an toàn cho renderer
    dwgReader.js        Đọc và chuyển đổi DWG bằng LibreDWG WASM
  renderer/
    App.jsx             Giao diện và luồng chính
    components/         Canvas, layer, modal và các bảng công cụ
    modules/            GIS importer, VN-2000 và layer store
```

## Kiểm tra trước khi gửi thay đổi

```powershell
npm.cmd run build:renderer
node --check src/main/main.js
node --check src/main/preload.js
node --check src/main/dwgReader.js
git diff --check
```

Khi thay đổi chức năng DWG/DXF, cần nhập lại file kiểm thử thay vì sử dụng
layer đã lưu từ phiên trước.

## Giới hạn hiện tại

- Chưa hỗ trợ đầy đủ mọi entity DWG nâng cao.
- `HATCH` chỉ sử dụng biên ngoài; mô hình thửa đất chưa hỗ trợ polygon có lỗ.
- Nội suy spline/NURBS chưa hoàn toàn tương đương AutoCAD.
- Font Times New Roman được dùng thay cho SHX/VNI nên kích thước chữ có thể
  không trùng tuyệt đối với bản vẽ gốc.
- Layer tham chiếu DWG lớn không được tự động lưu vào `localStorage`; cần mở
  lại file DWG sau khi khởi động lại ứng dụng.
- Renderer hiện có cảnh báo chunk lớn hơn 500 kB khi build.

## Tài liệu phát triển

Xem [`AI_HANDOFF.md`](AI_HANDOFF.md) để biết chi tiết kiến trúc, mô hình dữ
liệu, luồng xử lý DWG/DXF, quyết định kỹ thuật và nhật ký thay đổi.

## Giấy phép

Dự án được phát hành theo giấy phép
[GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`). Việc sử dụng GPL
là bắt buộc do dự án tích hợp LibreDWG theo GPL-3.0.
