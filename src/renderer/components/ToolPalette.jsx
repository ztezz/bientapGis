import React, { useEffect, useRef, useState } from 'react'
import './ToolPalette.css'

export default function ToolPalette({ group, activeTool, onSelect }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const active = group.tools.find(tool => tool.id === activeTool) || group.tools[0]

  useEffect(() => {
    if (!open) return
    const close = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={rootRef} className={`tool-palette ${group.tools.some(tool => tool.id === activeTool) ? 'is-active' : ''}`}>
      <button className="tool-palette-trigger" onClick={() => group.tools.length === 1 ? onSelect(active.id) : setOpen(value => !value)} title={`${active.label} [${active.shortcut}]`}>
        <span>{active.icon}</span><b>{group.label}</b>{group.tools.length > 1 && <i>⌄</i>}
      </button>
      {open && group.tools.length > 1 && (
        <div className="tool-palette-menu">
          <strong>{group.label}</strong>
          {group.tools.map(tool => (
            <button key={tool.id} className={tool.id === activeTool ? 'is-active' : ''} onClick={() => { onSelect(tool.id); setOpen(false) }}>
              <span>{tool.icon}</span><div><b>{tool.label}</b><em>{tool.description || ''}</em></div><kbd>{tool.shortcut}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
