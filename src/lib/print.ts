import type { StudyOutput } from '../types'

/**
 * نسخة للطباعة: الأسئلة مع مساحة للإجابة، ثم نموذج الإجابة في صفحة منفصلة.
 * تُفتح في نافذة مستقلة بتنسيق عربي بسيط، والمتصفح يطبعها أو يحفظها PDF.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const plain = (s: string) => esc(s.replace(/\*\*|`/g, '').replace(/\s?\[\d+\]/g, ''))

export function printOutput(o: StudyOutput, meta: { subject?: string; book?: string; lesson?: string } = {}) {
  const d = o.data
  let body = ''
  if (d.kind === 'quiz') {
    const qs = d.questions
    body += `<ol class="qs">${qs
      .map((q) => `<li><p>${plain(q.q)}</p>${q.options ? `<ul class="opts">${q.options.map((x) => `<li>${plain(x)}</li>`).join('')}</ul>` : `<div class="space" style="height:${q.type === 'essay' || q.type === 'problem' ? 9 : 4}em"></div>`}${q.cite ? `<small>المصدر: ${esc(q.cite.bookTitle)}، ص ${q.cite.printed ?? q.cite.page}</small>` : ''}</li>`)
      .join('')}</ol>`
    body += `<section class="key"><h2>نموذج الإجابة</h2><ol>${qs.map((q) => `<li><p>${plain(q.answer)}</p>${q.why ? `<p class="why">${plain(q.why)}</p>` : ''}${q.flag ? `<p class="flag">تحتاج مراجعة: ${esc(q.flag)}</p>` : ''}</li>`).join('')}</ol></section>`
  } else if (d.kind === 'cards') body += `<ol class="qs">${d.cards.map((c) => `<li><p><b>${plain(c.front)}</b></p><p>${plain(c.back)}</p></li>`).join('')}</ol>`
  else if (d.kind === 'mindmap') {
    const walk = (n: { label: string; children?: typeof n[] }): string => `<li>${plain(n.label)}${n.children?.length ? `<ul>${n.children.map(walk).join('')}</ul>` : ''}</li>`
    body += `<ul class="tree">${walk(d.root)}</ul>`
  } else
    body += d.text
      .split('\n')
      .map((l) => (l.startsWith('### ') ? `<h3>${plain(l.slice(4))}</h3>` : l.startsWith('- ') ? `<p class="li">• ${plain(l.slice(2))}</p>` : l.startsWith('> ') ? `<p class="add">${plain(l.slice(2))}</p>` : l.trim() ? `<p>${plain(l)}</p>` : ''))
      .join('')
  const head = [meta.subject, meta.book, meta.lesson].filter((x): x is string => !!x).map(esc).join(' · ')
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>
body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;color:#1d1a24;margin:2cm 1.6cm;line-height:1.8;font-size:13pt}
h1{font-size:17pt;margin:0 0 .2em}header{border-bottom:1.5px solid #56409a;margin-bottom:1em;padding-bottom:.4em}header small{color:#555}
.name{margin:.4em 0 1em;color:#444}.qs>li{margin-bottom:1.1em;break-inside:avoid}.opts{list-style:arabic-indic;margin:.2em 1.5em}
.space{border-bottom:1px dotted #999;margin:.3em 0}.key{break-before:page}.why{color:#444}.flag{color:#a5343c}.add{color:#56409a}
small{color:#666}h3{color:#56409a;margin:.8em 0 .2em}.tree ul{margin-right:1.2em}@media print{button{display:none}}
</style></head><body><header><h1>${esc(o.title)}</h1><small>${head}${head ? ' · ' : ''}من إعداد رفيق اعتماداً على الكتاب</small></header>${d.kind === 'quiz' ? '<p class="name">الاسم: ........................ التاريخ: ..............</p>' : ''}${body}<button onclick="print()">طباعة</button></body></html>`
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
  return true
}
