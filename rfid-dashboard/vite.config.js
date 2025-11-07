import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// proxy /api calls to our Node API on :3000
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // if you need websockets later:
        ws: true,
      },
    },
  },
})
