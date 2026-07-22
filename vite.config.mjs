import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron']
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@modules': path.resolve(__dirname, 'src/renderer/modules'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@styles': path.resolve(__dirname, 'src/renderer/styles')
    }
  },
  optimizeDeps: {
    exclude: ['electron']
  }
})
