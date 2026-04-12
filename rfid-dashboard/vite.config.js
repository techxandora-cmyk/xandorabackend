import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // eslint-disable-next-line no-undef
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-core'
          }

          if (/[\\/]node_modules[\\/]react-router(?:-dom)?[\\/]/.test(id)) {
            return 'router'
          }

          if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) {
            return 'motion'
          }

          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return 'icons'
          }

          if (
            /[\\/]node_modules[\\/](three|@react-three[\\/](fiber|drei))[\\/]/.test(id)
          ) {
            return 'three'
          }

          return 'vendor'
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
