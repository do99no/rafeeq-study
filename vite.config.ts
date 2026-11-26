import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// مسار نسبي كي يعمل داخل أي مجلد على GitHub Pages
export default defineConfig({ base: './', plugins: [react()] })
