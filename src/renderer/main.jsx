import React, { Component } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './App.css'

const rootElement = document.getElementById('root')

class StartupErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) { console.error('[StartupErrorBoundary]', error, info) }

  clearData = () => {
    localStorage.removeItem('vn_land_editor_layers')
    localStorage.removeItem('vn_land_editor_layers_backup')
    location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 32, background: '#0f1221', color: '#e2e8f0', font: '14px/1.5 Segoe UI, sans-serif' }}>
        <div style={{ maxWidth: 720, padding: 24, border: '1px solid #7f1d1d', borderRadius: 12, background: '#181425' }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 18, color: '#fca5a5' }}>Không thể khởi động giao diện</h1>
          <p style={{ margin: '0 0 14px', color: '#94a3b8' }}>Ứng dụng gặp lỗi khi tải dữ liệu cục bộ. Bạn có thể xóa dữ liệu khôi phục rồi mở lại.</p>
          <pre style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', color: '#fecaca' }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <button onClick={this.clearData} style={{ marginTop: 16, padding: '8px 12px', border: 0, borderRadius: 6, background: '#dc2626', color: 'white', cursor: 'pointer' }}>Xóa dữ liệu cục bộ và tải lại</button>
        </div>
      </div>
    )
  }
}

window.addEventListener('error', event => console.error('[WindowError]', event.error || event.message))
window.addEventListener('unhandledrejection', event => console.error('[UnhandledRejection]', event.reason))

try {
  createRoot(rootElement).render(<StartupErrorBoundary><App /></StartupErrorBoundary>)
} catch (error) {
  console.error('[RootRenderError]', error)
}
