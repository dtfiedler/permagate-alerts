import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  build: {},
  base: '/',
  plugins: [react(), nodePolyfills(), tailwindcss()],
});
