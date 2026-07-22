/**
 * SettingsModal.jsx - Modal cài đặt AI Provider
 *
 * Cho phép người dùng tự cấu hình:
 *   - Base URL (endpoint OpenAI-compatible)
 *   - API Key
 *   - Model chính
 *   - Danh sách fallback models
 *   - Timeout, max tokens, temperature
 *   - Image scale, image detail
 *
 * Tích hợp nút "Test Connection" để kiểm tra live.
 */

import React, { useState, useEffect } from 'react'
import {
  getSettings,
  saveSettings,
  resetSettings,
  testConnection,
  DEFAULT_SETTINGS
} from '@modules/settingsStore'
import './SettingsModal.css'

// ============================================================
// PRESET NHANH
// ============================================================

const PRESETS = [
  {
    label: '9Router (Local)',
    icon: '⚡',
    description: 'localhost:20128 – Smart fallback 60+ providers',
    values: { baseUrl: 'http://localhost:20128/v1', apiKey: '', model: 'claude-opus-4-5' }
  },
  {
    label: 'OpenAI',
    icon: '🤖',
    description: 'api.openai.com – GPT-4o Vision',
    values: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }
  },
  {
    label: 'Anthropic',
    icon: '🧠',
    description: 'api.anthropic.com – Claude Vision',
    values: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-4-5' }
  },
  {
    label: 'Google Gemini',
    icon: '✨',
    description: 'generativelanguage.googleapis.com',
    values: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' }
  },
  {
    label: 'OpenRouter',
    icon: '🔀',
    description: 'openrouter.ai – 200+ models',
    values: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-4-5' }
  },
  {
    label: 'Custom / Self-hosted',
    icon: '🛠️',
    description: 'Nhập URL tùy chỉnh',
    values: { baseUrl: '', model: '' }
  },
]

const SUGGESTED_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-3-5',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash',
  'anthropic/claude-opus-4-5',
  'openai/gpt-4o',
  'google/gemini-2.0-flash',
]

// ============================================================
// COMPONENT CHÍNH
// ============================================================

export default function SettingsModal({ open, onClose }) {
  const [form, setForm]           = useState(() => getSettings())
  const [testStatus, setTestStatus] = useState(null)   // null | 'testing' | 'ok' | 'error'
  const [testMsg, setTestMsg]     = useState('')
  const [fetchedModels, setFetchedModels] = useState([])
  const [saved, setSaved]         = useState(false)
  const [errors, setErrors]       = useState({})
  const [showKey, setShowKey]     = useState(false)
  const [newFbModel, setNewFbModel] = useState('')

  // Reload form mỗi khi mở
  useEffect(() => {
    if (open) {
      setForm(getSettings())
      setTestStatus(null)
      setTestMsg('')
      setErrors({})
      setSaved(false)
      setFetchedModels([])
    }
  }, [open])

  // Đóng bằng Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // ──────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: undefined }))
    setSaved(false)
  }

  const applyPreset = (preset) => {
    setForm(prev => ({ ...prev, ...preset.values }))
    setTestStatus(null)
    setTestMsg('')
    setSaved(false)
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMsg('Đang kiểm tra kết nối...')
    setFetchedModels([])

    const { ok, models, error } = await testConnection({
      baseUrl: form.baseUrl,
      apiKey:  form.apiKey
    })

    if (ok) {
      setTestStatus('ok')
      setTestMsg(`Kết nối thành công! Tìm thấy ${models.length} model.`)
      setFetchedModels(models)
    } else {
      setTestStatus('error')
      setTestMsg(error || 'Kết nối thất bại')
    }
  }

  const handleSave = () => {
    const errs = {}
    if (!form.baseUrl?.trim()) errs.baseUrl = 'Không được để trống'
    else if (!form.baseUrl.startsWith('http')) errs.baseUrl = 'Phải bắt đầu bằng http:// hoặc https://'
    if (!form.model?.trim()) errs.model = 'Không được để trống'
    if (form.timeout < 5000 || form.timeout > 300000) errs.timeout = 'Từ 5000ms đến 300000ms'
    if (form.temperature < 0 || form.temperature > 2) errs.temperature = 'Từ 0 đến 2'

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    try {
      saveSettings(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErrors({ general: e.message })
    }
  }

  const handleReset = () => {
    if (!window.confirm('Reset về cài đặt mặc định?')) return
    const def = resetSettings()
    setForm(def)
    setSaved(false)
    setErrors({})
    setTestStatus(null)
  }

  // Fallback models management
  const addFallbackModel = () => {
    const m = newFbModel.trim()
    if (!m) return
    if (form.fallbackModels.includes(m)) return
    set('fallbackModels', [...form.fallbackModels, m])
    setNewFbModel('')
  }

  const removeFallbackModel = (model) => {
    set('fallbackModels', form.fallbackModels.filter(m => m !== model))
  }

  const moveFallbackModel = (idx, dir) => {
    const arr = [...form.fallbackModels]
    const target = idx + dir
    if (target < 0 || target >= arr.length) return
    ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
    set('fallbackModels', arr)
  }

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────

  const allModelSuggestions = [...new Set([
    ...SUGGESTED_MODELS,
    ...fetchedModels
  ])]

  return (
    <div className="settings-overlay">
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Cài đặt AI">

        {/* ── Header ── */}
        <div className="settings-header">
          <div className="settings-header-left">
            <span className="settings-icon">⚙️</span>
            <div>
              <h2>Cài đặt AI Provider</h2>
              <p>Cấu hình endpoint, model và API key cho tính năng OCR</p>
            </div>
          </div>
          <button className="settings-close-btn" onClick={onClose} title="Đóng (Esc)">✕</button>
        </div>

        <div className="settings-body">

          {/* ── Presets ── */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <span className="section-icon">🚀</span> Chọn nhanh Provider
            </h3>
            <div className="presets-grid">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  className={`preset-card ${form.baseUrl === p.values.baseUrl ? 'preset-card--active' : ''}`}
                  onClick={() => applyPreset(p)}
                  title={p.description}
                >
                  <span className="preset-icon">{p.icon}</span>
                  <span className="preset-label">{p.label}</span>
                  <span className="preset-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="settings-divider" />

          {/* ── Connection ── */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <span className="section-icon">🔌</span> Kết nối
            </h3>

            <div className="form-row">
              <label className="form-label">
                Base URL <span className="required">*</span>
                <span className="form-hint">Endpoint OpenAI-compatible</span>
              </label>
              <div className="input-with-action">
                <input
                  type="text"
                  className={`form-input ${errors.baseUrl ? 'form-input--error' : ''}`}
                  value={form.baseUrl}
                  onChange={e => set('baseUrl', e.target.value)}
                  placeholder="http://localhost:20128/v1"
                  spellCheck={false}
                />
                <button
                  className={`test-btn test-btn--${testStatus || 'idle'}`}
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing'}
                  title="Kiểm tra kết nối"
                >
                  {testStatus === 'testing' ? (
                    <span className="spinner" />
                  ) : testStatus === 'ok' ? '✓ OK' : testStatus === 'error' ? '✗ Lỗi' : '⚡ Test'}
                </button>
              </div>
              {errors.baseUrl && <p className="form-error">{errors.baseUrl}</p>}
              {testMsg && (
                <p className={`test-message test-message--${testStatus}`}>{testMsg}</p>
              )}
            </div>

            <div className="form-row">
              <label className="form-label">
                API Key
                <span className="form-hint">Để trống nếu proxy không yêu cầu (vd: 9Router local)</span>
              </label>
              <div className="input-with-action">
                <input
                  type={showKey ? 'text' : 'password'}
                  className="form-input form-input--mono"
                  value={form.apiKey}
                  onChange={e => set('apiKey', e.target.value)}
                  placeholder="sk-... hoặc để trống"
                  autoComplete="off"
                />
                <button
                  className="icon-btn"
                  onClick={() => setShowKey(v => !v)}
                  title={showKey ? 'Ẩn' : 'Hiện'}
                >
                  {showKey ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          </section>

          <div className="settings-divider" />

          {/* ── Model ── */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <span className="section-icon">🤖</span> Model chính
            </h3>

            <div className="form-row">
              <label className="form-label">
                Model ID <span className="required">*</span>
                <span className="form-hint">Model ưu tiên khi gọi OCR</span>
              </label>
              <div className="model-select-wrapper">
                <input
                  type="text"
                  list="model-suggestions"
                  className={`form-input form-input--mono ${errors.model ? 'form-input--error' : ''}`}
                  value={form.model}
                  onChange={e => set('model', e.target.value)}
                  placeholder="claude-opus-4-5"
                />
                <datalist id="model-suggestions">
                  {allModelSuggestions.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              {errors.model && <p className="form-error">{errors.model}</p>}

              {/* Model chips từ server */}
              {fetchedModels.length > 0 && (
                <div className="model-chips-wrapper">
                  <p className="chips-label">Model khả dụng từ endpoint:</p>
                  <div className="model-chips">
                    {fetchedModels.slice(0, 20).map(m => (
                      <button
                        key={m}
                        className={`model-chip ${form.model === m ? 'model-chip--active' : ''}`}
                        onClick={() => set('model', m)}
                        title={m}
                      >
                        {m.length > 30 ? m.slice(0, 28) + '…' : m}
                      </button>
                    ))}
                    {fetchedModels.length > 20 && (
                      <span className="chips-more">+{fetchedModels.length - 20} model khác</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="settings-divider" />

          {/* ── Fallback ── */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <span className="section-icon">🔄</span> Fallback Models
              <label className="toggle-inline" title="Tự động thử model tiếp theo khi lỗi">
                <input
                  type="checkbox"
                  checked={form.fallback}
                  onChange={e => set('fallback', e.target.checked)}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-label">{form.fallback ? 'Bật' : 'Tắt'}</span>
              </label>
            </h3>
            <p className="section-desc">
              Khi model chính thất bại hoặc hết quota, tự động thử các model theo thứ tự dưới đây.
            </p>

            {form.fallback && (
              <>
                <div className="fallback-list">
                  {form.fallbackModels.length === 0 && (
                    <p className="empty-hint">Chưa có model fallback. Thêm bên dưới.</p>
                  )}
                  {form.fallbackModels.map((m, idx) => (
                    <div key={m + idx} className="fallback-item">
                      <span className="fallback-order">{idx + 1}</span>
                      <span className="fallback-name" title={m}>{m}</span>
                      <div className="fallback-actions">
                        <button
                          className="fb-btn"
                          onClick={() => moveFallbackModel(idx, -1)}
                          disabled={idx === 0}
                          title="Lên"
                        >↑</button>
                        <button
                          className="fb-btn"
                          onClick={() => moveFallbackModel(idx, 1)}
                          disabled={idx === form.fallbackModels.length - 1}
                          title="Xuống"
                        >↓</button>
                        <button
                          className="fb-btn fb-btn--del"
                          onClick={() => removeFallbackModel(m)}
                          title="Xóa"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="fallback-add">
                  <input
                    type="text"
                    list="model-suggestions-fb"
                    className="form-input form-input--mono form-input--sm"
                    value={newFbModel}
                    onChange={e => setNewFbModel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addFallbackModel() }}
                    placeholder="Nhập model ID rồi Enter hoặc nhấn Thêm..."
                  />
                  <datalist id="model-suggestions-fb">
                    {allModelSuggestions
                      .filter(m => !form.fallbackModels.includes(m))
                      .map(m => <option key={m} value={m} />)}
                  </datalist>
                  <button className="add-fb-btn" onClick={addFallbackModel}>+ Thêm</button>
                </div>
              </>
            )}
          </section>

          <div className="settings-divider" />

          {/* ── Advanced ── */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <span className="section-icon">🔧</span> Tham số nâng cao
            </h3>

            <div className="advanced-grid">

              <div className="form-row">
                <label className="form-label">
                  Timeout (ms)
                  <span className="form-hint">Thời gian chờ tối đa mỗi request</span>
                </label>
                <div className="slider-row">
                  <input
                    type="range"
                    min="5000" max="300000" step="5000"
                    value={form.timeout}
                    onChange={e => set('timeout', Number(e.target.value))}
                    className="form-range"
                  />
                  <input
                    type="number"
                    className={`form-input form-input--sm form-input--num ${errors.timeout ? 'form-input--error' : ''}`}
                    value={form.timeout}
                    min="5000" max="300000" step="1000"
                    onChange={e => set('timeout', Number(e.target.value))}
                  />
                  <span className="unit">{(form.timeout / 1000).toFixed(0)}s</span>
                </div>
                {errors.timeout && <p className="form-error">{errors.timeout}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Max Tokens
                  <span className="form-hint">Giới hạn token đầu ra của model</span>
                </label>
                <div className="slider-row">
                  <input
                    type="range"
                    min="256" max="4096" step="128"
                    value={form.maxTokens}
                    onChange={e => set('maxTokens', Number(e.target.value))}
                    className="form-range"
                  />
                  <input
                    type="number"
                    className="form-input form-input--sm form-input--num"
                    value={form.maxTokens}
                    min="256" max="4096" step="128"
                    onChange={e => set('maxTokens', Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">
                  Temperature
                  <span className="form-hint">0 = chính xác/deterministic, cao hơn = sáng tạo hơn</span>
                </label>
                <div className="slider-row">
                  <input
                    type="range"
                    min="0" max="2" step="0.05"
                    value={form.temperature}
                    onChange={e => set('temperature', Number(e.target.value))}
                    className="form-range"
                  />
                  <input
                    type="number"
                    className={`form-input form-input--sm form-input--num ${errors.temperature ? 'form-input--error' : ''}`}
                    value={form.temperature}
                    min="0" max="2" step="0.05"
                    onChange={e => set('temperature', Number(e.target.value))}
                  />
                </div>
                {errors.temperature && <p className="form-error">{errors.temperature}</p>}
              </div>

              <div className="form-row">
                <label className="form-label">
                  Image Detail
                  <span className="form-hint">Độ chi tiết ảnh gửi lên model (OpenAI vision)</span>
                </label>
                <div className="radio-group">
                  {['low', 'high', 'auto'].map(v => (
                    <label key={v} className={`radio-option ${form.imageDetail === v ? 'radio-option--active' : ''}`}>
                      <input
                        type="radio"
                        name="imageDetail"
                        value={v}
                        checked={form.imageDetail === v}
                        onChange={() => set('imageDetail', v)}
                      />
                      <span className="radio-label">{v}</span>
                      {v === 'high' && <span className="radio-badge">Khuyến nghị</span>}
                    </label>
                  ))}
                </div>
              </div>

            </div>
          </section>

          {/* ── General Error ── */}
          {errors.general && (
            <div className="general-error">⚠️ {errors.general}</div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="settings-footer">
          <button className="btn-reset" onClick={handleReset} title="Khôi phục mặc định">
            ↺ Reset mặc định
          </button>
          <div className="footer-right">
            <button className="btn-cancel" onClick={onClose}>Hủy</button>
            <button
              className={`btn-save ${saved ? 'btn-save--saved' : ''}`}
              onClick={handleSave}
            >
              {saved ? '✓ Đã lưu!' : '💾 Lưu cài đặt'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
