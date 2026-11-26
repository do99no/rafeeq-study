// ينسخ ملفات قارئ PDF والتعرف الضوئي إلى public كي تعمل دون خدمات خارجية.
import { cpSync, mkdirSync } from 'node:fs'

const copy = (from, to) => cpSync(`node_modules/${from}`, `public/${to}`, { recursive: true })
mkdirSync('public/vendor/ocr', { recursive: true })
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) copy(`pdfjs-dist/${d}`, `vendor/pdfjs/${d}`)
copy('tesseract.js/dist/worker.min.js', 'vendor/ocr/worker.min.js')
for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm'])
  copy(`tesseract.js-core/tesseract-core-${v}.wasm.js`, `vendor/ocr/tesseract-core-${v}.wasm.js`)
for (const l of ['ara', 'eng']) copy(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `vendor/ocr/${l}.traineddata.gz`)
