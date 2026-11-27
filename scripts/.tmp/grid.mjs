// يجمع صوراً في لوحة واحدة مع عنوان لكل صورة: node grid.mjs out.png cols img1 img2 ...
import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'fs'
const [out, cols, ...files] = process.argv.slice(2)
const imgs = await Promise.all(files.map((f) => loadImage(fs.readFileSync(f))))
const w = 520, scale = (i) => w / i.width
const hs = imgs.map((i) => i.height * scale(i))
const rows = Math.ceil(imgs.length / cols), rh = Math.max(...hs) + 30
const c = createCanvas(w * cols, rh * rows), x = c.getContext('2d')
x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height)
imgs.forEach((im, k) => { const cx = (k % cols) * w, cy = Math.floor(k / cols) * rh; x.fillStyle = '#c00'; x.font = 'bold 22px sans-serif'; x.fillText(files[k].split(/[\/]/).pop(), cx + 8, cy + 22); x.drawImage(im, cx, cy + 28, w - 6, hs[k]) })
fs.writeFileSync(out, c.toBuffer('image/png'))
