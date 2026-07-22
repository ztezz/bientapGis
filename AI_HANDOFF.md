# VN-LandEditor - AI Handoff

Tai lieu nay la nguon thong tin ban giao cho AI va lap trinh vien tiep theo.
Doc file nay truoc khi sua ma. Sau moi lan thay doi chuc nang, bat buoc cap nhat
muc **Nhat ky thay doi** o cuoi file.

## Quy tac cap nhat tai lieu

Sau moi lan sua ma:

1. Cap nhat ngay trong muc `Nhat ky thay doi`.
2. Ghi ro file da sua, hanh vi moi va ly do ky thuat.
3. Ghi lenh da dung de kiem tra, vi du `npm.cmd run build:renderer`.
4. Ghi gioi han hoac viec chua lam neu co.
5. Neu thay doi kien truc, cap nhat cac muc kien truc tuong ung, khong chi them log.
6. Khong xoa lich su cu tru khi thong tin da sai; danh dau noi dung da duoc thay the.

## Tong quan

- Ten ung dung: `VN-LandEditor`.
- Nen tang: Electron 32, React 18, Vite 5.
- Canvas: Fabric.js 5.
- GIS: Proj4, Leaflet.
- OCR: Tesseract.js.
- Muc tieu: bien tap thua dat VN-2000, OCR toa do, nhap/xuat GIS, mo DXF/DWG.
- Giay phep hien tai: `GPL-3.0-only` do tich hop LibreDWG GPL-3.0.

## Lenh quan trong

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build:renderer
npm.cmd run build
```

PowerShell tren may co the chan `npm.ps1`; dung `npm.cmd`.

Dong goi portable khi Windows khong co quyen tao symbolic link:

```powershell
npx.cmd electron-builder --dir --config.win.signAndEditExecutable=false
```

Executable portable:

```text
dist-electron\win-unpacked\VN-LandEditor.exe
```

Neu dong goi bao `Access is denied`, mot tien trinh dang giu file trong
`dist-electron\win-unpacked`. Dong VN-LandEditor/Electron truoc khi build.

## Cau truc thu muc

```text
src/
  main/
    main.js             Electron main, IPC, window, dialog
    preload.js          contextBridge API
    dwgReader.js        LibreDWG WASM, doc DWG, block, text, font, linetype
  renderer/
    App.jsx             root UI, tool, modal, layer workflow
    App.css             layout va frameless title bar
    main.jsx            React root va StartupErrorBoundary
    components/
      CanvasEditor.jsx  render/bien tap Fabric, CAD reference renderer
      ImportModal.jsx   nhap JSON/GeoJSON/CSV/DXF/DWG
      LayerPanel.jsx    quan ly layer, xoa tat ca
    modules/
      gisImporter.js    chuyen file/parser thanh layer model
      layerStore.js     state, history, autosave, import/export
      useLayerManager.js
      vn2000.js
```

## Mo hinh du lieu

### Parcel layer

```js
{
  id,
  name,
  type: 'parcel',
  visible,
  locked,
  opacity,
  color,
  fillColor,
  order,
  parcels: []
}
```

### CAD reference layer

```js
{
  id,
  name: 'CAD · <ten layer>',
  type: 'reference',
  visible: true,
  locked: true,
  opacity,
  color,
  order,
  parcels: [],
  cadEntities: [],
  cadTexts: []
}
```

Layer sinh ra tu cung mot lan mo DWG co them metadata nhom:

```js
{
  sourceGroupId,       // ID rieng cho lan import
  sourceGroupName,     // ten file DWG
  sourceFormat: 'DWG'
}
```

`LayerPanel` dung metadata nay de hien thi cay `file DWG -> layer`. File DWG
mac dinh thu gon; layer khong co metadata nhom van hien thi o cap goc.

`cadEntities` chi de hien thi va bat diem. Chung khong phai thua dat.

```js
{
  id,
  sourceType,
  closed,
  coordinates: [{ point, x, y }],
  lineType,
  lineTypeScale,
  lineTypePattern
}
```

`cadTexts`:

```js
{
  id,
  sourceType,
  text,
  x,
  y,
  textHeight,
  styleName,
  font,
  xScale,
  rotation,
  halign,
  valign,
  attachment
}
```

## Quy uoc toa do

- Ung dung luu VN-2000: `x = Northing`, `y = Easting`.
- AutoCAD: `X = Easting`, `Y = Northing`.
- Khi nhap CAD:

```text
VN-2000 x = CAD Y
VN-2000 y = CAD X
```

- `CanvasEditor.worldToCanvas`: ngang dung `coord.y`, doc dung `coord.x` va dao chieu Y.
- Khong doi quy uoc nay neu khong kiem tra toan bo basemap, snapping va export.

## DXF

Parser: `src/renderer/modules/gisImporter.js`.

Ho tro DXF ASCII:

- `LWPOLYLINE` khép kin.
- `POLYLINE` 2D khép kin.
- Giu ten layer CAD.
- Doc `$INSUNITS` va doi ve met.
- Duong ho khong tao thua.
- DXF binary chua ho tro.
- Bulge DXF hien chua noi suy chinh xac nhu DWG.

## DWG

### Thu vien

- Package: `@mlightcad/libredwg-web`.
- Chay offline bang WebAssembly.
- Khong can AutoCAD hoac ODA File Converter.
- WASM duoc dong goi bang `extraResources` vao `resources/libredwg-wasm`.

### Luong doc

```text
ImportModal
  -> preload openDWG
  -> main.js dialog:openDWG
  -> dwgReader.readDWG
  -> LibreDWG convertEx
  -> parseDWG trong gisImporter
  -> reference layers + layer "Vung tao tu DWG"
```

### Entity ho tro

- `LINE`
- `ARC`
- `CIRCLE`
- `ELLIPSE`
- `LWPOLYLINE`
- `POLYLINE2D`
- bien ngoai `HATCH`
- `TEXT`
- `MTEXT`
- `ATTRIB`
- `INSERT` va block long nhau, toi da 8 cap

Block transform bao gom base point, insertion point, X/Y scale va rotation.
Entity layer `0` trong block ke thua layer cua `INSERT`.

### Linetype

Doc bang `LTYPE`, linetype entity va linetype layer.

- `BYLAYER` duoc resolve theo bang layer.
- `DASHED2` va `DOT2` duoc giu pattern.
- Renderer nhom entity theo pattern va dung `setLineDash`.
- File `LO G37 (1).dwg` co 228 `DASHED2` va 3 `DOT2`.

### Text va bang ma tieng Viet

- Toan bo text DWG hien thi bang `Times New Roman` theo yeu cau.
- VNI, TCVN3, VIQR va chuoi VNI/Unicode tron duoc chuyen sang Unicode.
- Package ho tro: `vietnamese-conversion` (MIT).
- Co bo chuan hoa hau VNI cho cac mau con sot nhu:
  - `Đöờng` -> `Đường`
  - `Döông` -> `Dương`
  - `thöớc` -> `thước`
  - `Ngöời` -> `Người`
  - `Đòa` -> `Địa`
  - `đôn vò` -> `đơn vị`
  - `Sô đồ` -> `Sơ đồ`

Metric Times New Roman hien tai:

```text
TIMES_CAD_HEIGHT_FACTOR = 0.80
TIMES_CAD_BASELINE_OFFSET = 0.12
horizontal metric factor = 0.68 trong gisImporter.parseDWG
```

Text co alignment dung `endPoint`; text khong alignment dung `startPoint`.
`halign` va `valign` duoc map sang Canvas `textAlign`/`textBaseline`.

### Hieu nang DWG lon

File kiem thu `LO G37 (1).dwg`:

- Khoang 2.32 MB.
- Sau bung block: 17,255 hinh hoc.
- 11,536 text.
- Hon 246,000 diem noi suy.
- 24 layer sau import, gom layer vung trong.

Toi uu hien tai:

- Khong tao mot Fabric object cho tung entity.
- Moi CAD layer co custom geometry object va custom text object.
- Geometry ve bang Canvas API; moi entity bat dau bang `moveTo`.
- Chi ve entity/text trong viewport.
- Text qua nho duoc an o zoom thap.
- Snapping dung spatial grid `CAD_GRID_SIZE = 96`.
- Bounding box tinh bang vong lap, khong dung `Math.min(...mangLon)`.
- Grid Fabric bi an khi co CAD reference.
- Reference layer lon khong autosave vao `localStorage` de tranh quota.
- Parcel layer va vung nguoi dung tao van autosave.

## Canvas va cong cu bien tap

Cong cu:

- Chon vung (`V`).
- Quet nhieu vung (`B`).
- Ve vung (`D`).
- Sua dinh (`S`).
- Di chuyen vung (`G`).
- Them dinh (`A`).
- Xoa dinh (`X`).
- Do khoang cach (`M`).
- Pan (`H`).
- Bat diem (`N`).

Ve vung tren CAD:

- CAD reference layer mac dinh bi khoa.
- Van tham gia bat dinh va bat canh.
- Parcel moi ghi vao layer `Vung tao tu DWG`.
- Khong cho ve/sua tren layer khoa.

## Layer store va persistence

- `layerStore` co undo/redo.
- `reset()` xoa tat ca va tao lai `Lop thua dat`.
- Nut `Xoa tat ca` trong `LayerPanel` goi reset qua hop thoai xac nhan.
- Co the Undo sau khi xoa tat ca.
- Reference CAD lon khong duoc ghi vao localStorage.
- Khi mo lai ung dung, can mo lai file DWG; parcel da tao van duoc luu.
- Export/import project JSON giu `type`, `cadEntities`, `cadTexts` neu nguoi dung xuat thu cong.

## Electron window

- Cua so `frame: false`.
- Top bar la drag region.
- Co nut minimize, maximize/restore, close qua IPC.
- Renderer console error duoc ghi ra main terminal.
- `StartupErrorBoundary` trong `src/renderer/main.jsx` hien stack trace an toan.
- Khong thay `innerHTML` cua React root khi React dang render.

## File test thu cong

Hai file da dung de kiem thu, khong nam trong repository:

```text
C:\Users\USER\Downloads\CONG TY THANG MAY TACO-1442-SHCT.dwg
C:\Users\USER\Downloads\LO G37 (1).dwg
```

Khong hard-code duong dan tren vao ma nguon.

## Gioi han hien tai

- Khong render day du moi entity DWG nang cao.
- HATCH chi lay bien ngoai; model parcel chua ho tro polygon co lo.
- Spline HATCH dung fit points/control points, chua noi suy NURBS chinh xac.
- Times New Roman chi la font thay the; metric da tinh chinh nhung khong the trung 100% SHX/VNI.
- Reference DWG lon khong tu khoi phuc sau restart.
- Installer day du co the loi symbolic-link/sign tool tren Windows; portable `--dir` hoat dong.
- Build co canh bao renderer chunk lon hon 500 KB.

## Trang thai ban giao

- Cac thay doi DWG/DXF va `AI_HANDOFF.md` hien dang o working tree, chua commit.
- `AI_HANDOFF.md`, `LICENSE` va `src/main/dwgReader.js` la file moi chua duoc Git track.
- Renderer build thanh cong; main/preload/DWG reader deu qua kiem tra cu phap Node.
- Chua kiem thu lai thao tac import DWG tren giao dien trong phien ban giao nay.
- Khi tiep tuc, uu tien import lai ca file DWG nho va file lon, kiem tra hinh hoc,
  text, linetype, snapping, sau do moi dong goi portable.

## Checklist truoc khi ket thuc mot thay doi

1. Chay `npm.cmd run build:renderer`.
2. Chay `node --check` neu sua file trong `src/main`.
3. Chay `git diff --check`.
4. Neu sua DWG, thu ca file nho va file `LO G37 (1).dwg`.
5. Neu sua parser/main, xoa layer cu va import lai file khi kiem thu.
6. Neu chi sua renderer, dong/mo app la du, tru khi thay doi model du lieu.
7. Cap nhat file nay.

## Nhat ky thay doi

### 2026-07-22 - DWG/DXF, CAD reference va renderer lon

- Them parser DXF ASCII cho polyline khép kin.
- Tich hop LibreDWG WASM offline, chuyen license du an sang GPL-3.0-only.
- Mo DWG thanh CAD reference layer, khong tu tao parcel.
- Them layer `Vung tao tu DWG` de ve parcel bang snapping.
- Ho tro line, arc, circle, ellipse, polyline, hatch, text, mtext, attrib, insert.
- Bung block va transform day du.
- Them linetype DASHED2/DOT2.
- Chuyen bang ma VNI/TCVN3/VIQR sang Unicode.
- Ep font DWG sang Times New Roman va tinh chinh metric.
- Toi uu render file lon bang custom Canvas layer, viewport culling va spatial index.
- Sua call stack overflow trong `globalBBox`.
- An grid khi co CAD reference.
- Them frameless window controls.
- Them nut xoa tat ca layer co confirm va Undo.
- Them StartupErrorBoundary.
- File da sua: `package.json`, `package-lock.json`, `LICENSE`, cac file Electron
  main/preload, renderer, parser GIS, layer store va `AI_HANDOFF.md`.
- Kiem thu da chay:
  - `npm.cmd run build:renderer`: thanh cong, con canh bao chunk `739.26 kB`.
  - `node --check src/main/main.js`: thanh cong.
  - `node --check src/main/preload.js`: thanh cong.
  - `node --check src/main/dwgReader.js`: thanh cong.
  - `git diff --check`: thanh cong; Git chi canh bao LF se doi thanh CRLF.
- Gioi han/cong viec tiep theo: kiem thu import DWG thu cong va dong goi portable.

### 2026-07-22 - Them README

- Muc tieu: tao tai lieu gioi thieu va huong dan su dung du an.
- File da sua: `README.md`, `AI_HANDOFF.md`.
- Hanh vi moi: khong thay doi ma chay; bo sung huong dan cai dat, phat trien,
  build, toa do, DWG/DXF, phim tat, gioi han va giay phep.
- Kiem thu da chay: `git diff --check`.
- Gioi han/cong viec tiep theo: chua co anh chup giao dien trong README.

### 2026-07-22 - Nhom layer DWG theo cay thu muc

- Muc tieu: giam roi khi mo dong thoi nhieu file DWG.
- File da sua: `gisImporter.js`, `ImportModal.jsx`, `layerStore.js`,
  `LayerPanel.jsx`, `LayerPanel.css`, `README.md`, `AI_HANDOFF.md`.
- Hanh vi moi: moi file DWG la mot node thu muc co the thu gon/mo rong; cac
  layer CAD va `Vung tao tu DWG` nam ben trong dung file nguon.
- Quyet dinh ky thuat: gan `sourceGroupId`, `sourceGroupName`, `sourceFormat`
  vao layer; regenerate group ID khi append de tranh trung ID; giu metadata
  khi export/import JSON. Layer cu khong co metadata van hien thi cap goc.
- Kiem thu da chay: `npm.cmd run build:renderer`, `git diff --check`.
- Gioi han/cong viec tiep theo: chua co thao tac an/hien hoac xoa ca thu muc;
  hien tai cac thao tac van thuc hien tren tung layer con.

### Mau ghi cho lan sau

```md
### YYYY-MM-DD - Ten thay doi

- Muc tieu:
- File da sua:
- Hanh vi moi:
- Quyet dinh ky thuat:
- Kiem thu da chay:
- Gioi han/cong viec tiep theo:
```
