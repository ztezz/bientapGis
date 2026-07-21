import React, { useRef, useState } from 'react'
import { extractCoordsFromImage } from '@modules/ocr'
import ParcelPreview from '@components/ParcelPreview'
import './DataInputPanel.css'

const EMPTY_ROWS = [
  { point: '1', x: '', y: '' },
  { point: '2', x: '', y: '' },
  { point: '3', x: '', y: '' },
]

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({
      base64: reader.result,
      filename: file.name,
    })
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'))
    reader.readAsDataURL(file)
  })
}

export default function DataInputPanel({
  activeLayer,
  onCreateParcel,
  onOpenSettings,
}) {
  const [activeTab, setActiveTab] = useState('manual')
  const [rows, setRows] = useState(EMPTY_ROWS)
  const [errors, setErrors] = useState({})
  const [image, setImage] = useState(null)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [model, setModel] = useState('')
  const [ocrError, setOcrError] = useState('')
  const [rawOcr, setRawOcr] = useState('')
  const [axisMessage, setAxisMessage] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const fileInputRef = useRef(null)

  const updateRow = (index, field, value) => {
    setRows(current => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )))
    setErrors(current => {
      const next = { ...current }
      delete next[`${index}.${field}`]
      delete next.form
      return next
    })
  }

  const addRow = () => {
    setRows(current => [
      ...current,
      { point: String(current.length + 1), x: '', y: '' },
    ])
  }

  const removeRow = (index) => {
    setRows(current => current.filter((_, rowIndex) => rowIndex !== index))
    setErrors({})
  }

  const swapAxes = () => {
    setRows(current => current.map(row => ({ ...row, x: row.y, y: row.x })))
    setErrors({})
    setAxisMessage('Đã hoán đổi toàn bộ cột X và Y. Bấm lại để hoàn nguyên.')
  }

  const validateRows = () => {
    const nextErrors = {}

    if (rows.length < 3) {
      nextErrors.form = 'Cần ít nhất 3 điểm để tạo vùng.'
    }

    rows.forEach((row, index) => {
      if (row.x.trim() === '' || !Number.isFinite(Number(row.x))) {
        nextErrors[`${index}.x`] = true
      }
      if (row.y.trim() === '' || !Number.isFinite(Number(row.y))) {
        nextErrors[`${index}.y`] = true
      }
    })

    if (!nextErrors.form && Object.keys(nextErrors).length) {
      nextErrors.form = 'X và Y của tất cả các điểm phải là số hợp lệ.'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleCreate = () => {
    if (!activeLayer || activeLayer.locked || !validateRows()) return

    onCreateParcel?.(rows.map((row, index) => ({
      point: row.point.trim() || String(index + 1),
      x: Number(row.x),
      y: Number(row.y),
    })))
  }

  const setSelectedImage = selectedImage => {
    if (!selectedImage?.base64) return
    setImage(selectedImage)
    setProgress(0)
    setLogs([])
    setModel('')
    setOcrError('')
    setRawOcr('')
    setAxisMessage('')
  }

  const handleChooseImage = async () => {
    if (window.electronAPI?.openImage) {
      try {
        const selectedImage = await window.electronAPI.openImage()
        if (selectedImage) setSelectedImage(selectedImage)
        return
      } catch (error) {
        setOcrError(error.message || 'Không thể mở hộp thoại chọn ảnh.')
      }
    }
    fileInputRef.current?.click()
  }

  const handleFileChange = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setSelectedImage(await readImageFile(file))
    } catch (error) {
      setOcrError(error.message)
    }
  }

  const handleScan = async () => {
    if (!image?.base64 || isScanning) return

    setIsScanning(true)
    setProgress(0)
    setLogs([])
    setModel('')
    setOcrError('')
    setRawOcr('')
    setAxisMessage('')

    try {
      const result = await extractCoordsFromImage(image.base64, {
        onProgress: value => setProgress(Math.max(0, Math.min(100, Number(value) || 0))),
        onLog: message => setLogs(current => [...current, String(message)]),
      })

      setModel(result.modelUsed || '')
      setRawOcr(result.rawText || '')
      if (!result.coords?.length) {
        setOcrError('Không tìm thấy tọa độ trong ảnh. Hãy thử ảnh rõ hơn hoặc kiểm tra cấu hình OCR.')
        return
      }

      setRows(result.coords.map((coord, index) => ({
        point: String(coord.point || index + 1),
        x: String(coord.x),
        y: String(coord.y),
      })))
      setErrors({})
      if (result.coords.length >= 3) {
        setActiveTab('manual')
      } else {
        setOcrError(`AI trả về ${result.coords.length} điểm. Cần ít nhất 3 điểm; hãy xem kết quả thô bên dưới.`)
      }
    } catch (error) {
      setOcrError(error.message || 'Quét OCR thất bại.')
      setLogs(current => [...current, `Lỗi: ${error.message || 'Không xác định'}`])
    } finally {
      setIsScanning(false)
    }
  }

  const cannotCreate = !activeLayer || activeLayer.locked || isScanning

  return (
    <section className="dip-panel" aria-label="Nhập dữ liệu thửa đất">
      <header className="dip-header">
        <div>
          <h2>Nhập dữ liệu thửa đất</h2>
          <p>
            Lớp active: <strong style={{ color: activeLayer?.color }}>
              {activeLayer?.name || 'Chưa chọn lớp'}
            </strong>
          </p>
        </div>
        <span className={`dip-layer-status ${activeLayer && !activeLayer.locked ? 'is-ready' : ''}`} />
      </header>

      <div className="dip-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'manual'}
          className={activeTab === 'manual' ? 'is-active' : ''}
          onClick={() => setActiveTab('manual')}
        >
          Nhập thủ công
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ocr'}
          className={activeTab === 'ocr' ? 'is-active' : ''}
          onClick={() => setActiveTab('ocr')}
        >
          OCR ảnh
        </button>
      </div>

      <div className="dip-content">
        {activeTab === 'manual' ? (
          <div className="dip-manual" role="tabpanel">
            <div className="dip-section-heading">
              <div>
                <h3>Tọa độ VN-2000</h3>
                <span>{rows.length} điểm</span>
              </div>
              <div className="dip-coordinate-actions">
                <button type="button" className="dip-btn dip-btn--small dip-btn--swap" onClick={swapAxes} title="Hoán đổi X và Y của tất cả điểm">
                  ⇄ Đảo X/Y
                </button>
                <button type="button" className="dip-btn dip-btn--small" onClick={addRow}>
                  + Thêm dòng
                </button>
              </div>
            </div>

            <div className="dip-table-wrap">
              <table className="dip-table">
                <thead>
                  <tr>
                    <th>Điểm</th>
                    <th>X (Northing)</th>
                    <th>Y (Easting)</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          aria-label={`Điểm ${index + 1}`}
                          value={row.point}
                          onChange={event => updateRow(index, 'point', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Tọa độ X dòng ${index + 1}`}
                          className={errors[`${index}.x`] ? 'is-error' : ''}
                          inputMode="decimal"
                          value={row.x}
                          placeholder="0.000"
                          onChange={event => updateRow(index, 'x', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Tọa độ Y dòng ${index + 1}`}
                          className={errors[`${index}.y`] ? 'is-error' : ''}
                          inputMode="decimal"
                          value={row.y}
                          placeholder="0.000"
                          onChange={event => updateRow(index, 'y', event.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="dip-delete-row"
                          onClick={() => removeRow(index)}
                          title="Xóa dòng"
                          aria-label={`Xóa dòng ${index + 1}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ParcelPreview rows={rows} />

            {errors.form && <p className="dip-message dip-message--error">{errors.form}</p>}
            {axisMessage && <p className="dip-message dip-message--axis">{axisMessage}</p>}
            {!activeLayer && <p className="dip-message">Chọn một lớp active trước khi tạo vùng.</p>}
            {activeLayer?.locked && <p className="dip-message dip-message--error">Lớp active đang bị khóa.</p>}
          </div>
        ) : (
          <div className="dip-ocr" role="tabpanel">
            <input
              ref={fileInputRef}
              className="dip-file-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />

            <button type="button" className="dip-image-picker" onClick={handleChooseImage}>
              {image ? (
                <>
                  <img src={image.base64} alt="Ảnh bảng tọa độ đã chọn" />
                  <span className="dip-image-name">{image.filename || 'Ảnh đã chọn'}</span>
                  <span className="dip-image-change">Bấm để chọn ảnh khác</span>
                </>
              ) : (
                <>
                  <span className="dip-upload-icon">▧</span>
                  <strong>Chọn ảnh bảng tọa độ</strong>
                  <span>PNG, JPG, BMP, TIFF hoặc WEBP</span>
                </>
              )}
            </button>

            {(isScanning || progress > 0) && (
              <div className="dip-progress-block">
                <div className="dip-progress-label">
                  <span>{isScanning ? 'Đang nhận dạng...' : 'Đã quét xong'}</span>
                  <strong>{Math.round(progress)}%</strong>
                </div>
                <div className="dip-progress-track">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {model && (
              <div className="dip-model">
                <span>Model</span>
                <strong>{model}</strong>
              </div>
            )}

            {ocrError && <p className="dip-message dip-message--error">{ocrError}</p>}

            {rawOcr && (
              <details className="dip-raw-ocr" open={Boolean(ocrError)}>
                <summary>Kết quả thô từ AI</summary>
                <pre>{rawOcr}</pre>
              </details>
            )}

            {logs.length > 0 && (
              <div className="dip-log" aria-live="polite">
                <div className="dip-log-title">Nhật ký xử lý</div>
                {logs.map((entry, index) => <p key={index}>{entry}</p>)}
              </div>
            )}

            <p className="dip-ocr-hint">
              Kết quả sẽ được đưa sang bảng Nhập thủ công để kiểm tra và chỉnh sửa.
            </p>
          </div>
        )}
      </div>

      <footer className="dip-footer">
        {activeTab === 'ocr' ? (
          <>
            <button type="button" className="dip-settings" onClick={onOpenSettings}>
              Cài đặt OCR
            </button>
            <button
              type="button"
              className="dip-btn dip-btn--primary"
              disabled={!image || isScanning}
              onClick={handleScan}
            >
              {isScanning ? 'Đang quét...' : 'Quét ảnh'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dip-btn dip-btn--primary dip-create"
            disabled={cannotCreate}
            onClick={handleCreate}
          >
            Tạo vùng
          </button>
        )}
      </footer>
    </section>
  )
}
