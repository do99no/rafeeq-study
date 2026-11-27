import { useState } from 'react'
import { num } from '../lib/format'
import { load, save } from '../services/storage/local'
import { currentUser } from '../services/server/account'
import { actions } from '../store/store'
import type { Profile, StudentData } from '../types'
import { Dialog } from './Dialog'

/**
 * أول دخول بحساب: إن وُجدت على هذا الجهاز بيانات من الوضع السابق (دون حسابات)،
 * يختار الطالب بنفسه الملف الذي يخصه. لا يُنقل شيء دون اختياره، ولا يُعرض ملف نُقل من قبل.
 */
export function ImportLocal({ onClose }: { onClose: () => void }) {
  const app = load<{ profiles: Profile[] }>('local-profiles') ?? { profiles: [{ id: 's1', name: 'الطالب الأول' }, { id: 's2', name: 'الطالب الثاني' }] }
  const list = app.profiles
    .filter((p) => !p.id.startsWith('u:') && !load<string>(`imported:${p.id}`))
    .map((p) => ({ p, d: load<StudentData>(`data:${p.id}`) }))
    .filter((x): x is { p: Profile; d: StudentData } => !!x.d && (x.d.notebooks.length > 0 || x.d.outputs.length > 0 || Object.keys(x.d.studied ?? {}).length > 0))
  const [done, setDone] = useState(false)
  if (!list.length || done) return null
  const take = (p: Profile, d: StudentData) => {
    actions.importData(d)
    save(`imported:${p.id}`, currentUser()?.id ?? 'x')
    setDone(true)
    onClose()
  }
  return (
    <Dialog title="بيانات سابقة على هذا الجهاز" onClose={onClose}>
      <div className="form">
        <p>وجد رفيق بيانات دراسة محفوظة على هذا الجهاز من قبل تفعيل الحسابات. إن كانت لك فانقلها إلى حسابك. لا تختر ملف غيرك.</p>
        <ul className="admin-list">
          {list.map(({ p, d }) => (
            <li key={p.id}>
              <span className="grow">
                <strong>{p.name}</strong>{' '}
                <small className="muted">
                  {num(d.notebooks.length)} دفاتر · {num(d.outputs.length)} مواد محفوظة · {num(d.attempts.length)} اختبارات
                </small>
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => take(p, d)}>
                هذه بياناتي
              </button>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={onClose}>
          ليست لي، تخطَّ
        </button>
      </div>
    </Dialog>
  )
}
