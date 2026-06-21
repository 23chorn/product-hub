/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // @pap/shared is a monorepo workspace link, not a node_modules dependency, so Vite
  // treats it as project source and skips CJS→ESM interop on its (tsc-compiled,
  // CommonJS) output by default. Forcing it through esbuild's dependency pre-bundling
  // here makes its named exports resolve correctly in the browser.
  optimizeDeps: {
    include: ['@pap/shared'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
