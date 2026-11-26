import { useRef, useState } from 'react'
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { ConfirmDialog } from '../components/Dialog'
import { ServicesPanel } from '../components/ServicesPanel'
import { emptyData, parseBackup } from '../data/empty'
import { ago } from '../lib/format'
import { actions, getState, readSnapshot, useStore } from '../store/store'
import { toast } from '../store/toast'

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="setting">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function exportData() {
  const { data, activeId } = getState()
  const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'rafeeq', version: 2, data })], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `rafeeq-${activeId}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const CONFIRM = {
  import: { title: 'استيراد نسخة', text: 'ستحل النسخة محل بيانات الطالب الحالي. نحفظ بياناته الحالية أولاً كي تستعيدها.', action: 'استيراد' },
  empty: { title: 'مسح البيانات', text: 'ستُمسح دفاتر الطالب الحالي ومحادثاته ومراجعاته، وتبقى كتبه. نحفظ نسخة يمكن استعادتها. بيانات الطالب الآخر لن تتأثر.', action: 'مسح الكل' },
  restore: { title: 'استعادة النسخة', text: 'ستعود بيانات الطالب الحالي إلى آخر نسخة محفوظة، وتُحفظ الحالية مكانها.', action: 'استعادة' },
}

export default function Settings() {
  const settings = useStore((s) => s.data.settings)
  const profiles = useStore((s) => s.profiles)
  const activeId = useStore((s) => s.activeId)
  const [confirm, setConfirm] = useState<'import' | 'empty' | 'restore' | null>(null)

  const [incoming, setIncoming] = useState(emptyData)
  const file = useRef<HTMLInputElement>(null)
  const snap = readSnapshot(activeId)

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>الإعدادات</h1>
      </header>

      <section className="panel">
        <h2>العرض واللغة</h2>
        <Segmented label="المظهر" value={settings.theme} options={[['light', 'فاتح'], ['dark', 'داكن'], ['auto', 'حسب الجهاز']]} onChange={(theme) => actions.setSettings({ theme })} />
        <Segmented label="حجم الخط" value={settings.textSize} options={[['normal', 'عادي'], ['large', 'كبير']]} onChange={(textSize) => actions.setSettings({ textSize })} />
        <Segmented label="شكل الأرقام" value={settings.digits} options={[['arab', '١٢٣'], ['latn', '123']]} onChange={(digits) => actions.setSettings({ digits })} />
        <div className="setting">
          <span>لغة الواجهة</span>
          <span className="muted">العربية</span>
        </div>
      </section>

      <ServicesPanel />

      <section className="panel">
        <h2>الطالبان</h2>
        <p className="muted">لكل طالب دفاتره وكتبه وإعداداته. الفصل هنا للتنظيم داخل هذا المتصفح، وليس حماية بكلمة مرور.</p>
        {profiles.map((p) => (
          <div className="setting" key={p.id}>
            <input
              className="input"
              defaultValue={p.name}
              maxLength={30}
              aria-label={`اسم ${p.name}`}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (!name) e.target.value = p.name
                else if (name !== p.name) {
                  actions.renameProfile(p.id, name)
                  toast('تم حفظ الاسم.')
                }
              }}
            />
            {p.id === activeId ? (
              <span className="status" data-status="ready">
                الحالي
              </span>
            ) : (
              <button className="btn" onClick={() => actions.switchProfile(p.id)}>
                التبديل إليه
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>بيانات الطالب الحالي</h2>
        <div className="btn-row">
          <button className="btn" onClick={exportData}>
            <Download aria-hidden="true" /> تصدير نسخة
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            <Upload aria-hidden="true" /> استيراد نسخة
          </button>
          {snap && (
            <button className="btn" onClick={() => setConfirm('restore')}>
              <RotateCcw aria-hidden="true" /> استعادة نسخة {ago(snap.at)}
            </button>
          )}
          <button className="btn btn-danger-quiet" onClick={() => setConfirm('empty')}>
            <Trash2 aria-hidden="true" /> مسح الكل
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const parsed = parseBackup(await f.text().then(JSON.parse).catch(() => null))
            if (!parsed) return toast('هذا الملف ليس نسخة صالحة من رفيق.')
            setIncoming(parsed)
            setConfirm('import')
          }}
        />
        <p className="muted">تشمل النسخة الدفاتر والمحادثات والمراجعات والملاحظات. ملفات PDF لا تدخل فيها؛ أضف الملف نفسه على الجهاز الجديد فيُربط بالاستشهادات تلقائياً. لا توجد مزامنة بين الأجهزة.</p>
      </section>

      {confirm && (
        <ConfirmDialog
          {...CONFIRM[confirm]}
          onConfirm={() => {
            const ok = confirm === 'import' ? actions.importData(incoming) : confirm === 'empty' ? actions.clearAll() : actions.restoreSnapshot()
            toast(ok ? 'تم. يمكنك التراجع من زر الاستعادة.' : 'تعذّر حفظ نسخة احتياطية أولاً، فلم يتغير شيء.')
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
