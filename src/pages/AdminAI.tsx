import { useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, CircleX, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldAlert, Trash2, Zap } from 'lucide-react'
import { num } from '../lib/format'
import { api, ServerError } from '../services/server/account'
import { toast } from '../store/toast'

interface Free {
  status: 'verified' | 'unverified' | 'blocked'
  checked: string
  source?: string
  card?: string
  billing?: string
  limits?: string
  quota?: string
  data?: string
  age?: string
  use?: string
  reason?: string
}
interface Provider {
  id: string
  name: string
  free: Free
  confirm: Record<string, string> | null
  models: { id: string; vision: boolean; tier: string; arabic: string }[]
  approved: boolean
  approvedAt: number | null
  keys: number
}
interface Key {
  id: string
  provider: string
  label: string
  owner: string
  project: string
  source: 'env' | 'db'
  hint: string
  enabled: boolean
  status: string
  lastOk: number | null
  lastUsed: number | null
  lastError: string | null
  lastErrorAt: number | null
}
interface Sum {
  name?: string
  label?: string
  requests: number
  ok: number
  errors: number
  tokensIn: number
  tokensOut: number
}
interface Data {
  providers: Provider[]
  keys: Key[]
  projects: { provider: string; project: string; keys: number; quota: { state: string; used?: number; limit?: number; until?: number; reason?: string }; today: Sum }[]
  usage: { today: Sum; week: Sum; month: Sum; byProvider: Sum[]; byKey: Sum[]; byProject: Sum[]; byModel: Sum[]; byUser: Sum[] }
  errors: { at: number; key_id: string; provider: string; project: string; model: string; code: string; status: number | null; user_id: string }[]
  canAdd: boolean
}

const OWNER: Record<string, string> = { mohamed: 'محمد', amna: 'أمنة', family: 'العائلة', unassigned: 'غير محدد' }
const STATUS: Record<string, string> = { ok: 'يعمل', unknown: 'لم يُختبر', auth: 'غير صالح أو ملغى', quota: 'نفدت الحصة', rate: 'حد الدقيقة', error: 'خطأ', missing: 'أُزيل من الأسرار' }
const QUOTA: Record<string, string> = { available: 'متاح', near: 'قريب من الحد', exhausted: 'مستنفد', unknown: 'غير معروف' }
const ERR: Record<string, string> = { auth: 'مفتاح غير صالح', quota: 'نفاد الحصة', rate: 'حد الدقيقة', server: 'عطل لدى المزود', timeout: 'تأخر الرد', network: 'تعذّر الاتصال', model: 'النموذج غير متاح', bad_request: 'طلب مرفوض', too_large: 'نص طويل' }
const when = (t: number | null) => (t ? new Date(t).toLocaleString('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')
const tokens = (s: Sum) => (s.tokensIn + s.tokensOut > 0 ? num(s.tokensIn + s.tokensOut) : 'غير متاح')

function Usage({ title, rows, nameOf }: { title: string; rows: Sum[]; nameOf?: (n: string) => string }) {
  return (
    <section className="panel">
      <h3 className="mini-h">{title}</h3>
      {!rows.length && <p className="muted">لا استخدام في آخر 7 أيام.</p>}
      <ul className="admin-list">
        {rows.map((r) => (
          <li key={r.name}>
            <bdi className="grow">{r.label ?? nameOf?.(r.name!) ?? r.name}</bdi>
            <small className="muted">
              {num(r.requests)} طلب · {num(r.errors)} خطأ · الرموز: {tokens(r)}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProviderCard({ p, onDone }: { p: Provider; onDone: () => void }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)
  const set = async (approved: boolean) => {
    try {
      await api(`/admin/ai/providers/${p.id}`, { method: 'PUT', body: { approved, confirm: checks } })
      toast(approved ? `اعتُمد ${p.name}.` : `أوقف ${p.name}.`)
      setOpen(false)
      onDone()
    } catch (e) {
      toast(e instanceof ServerError && e.code === 'confirm_required' ? 'أكّد كل الشروط أولاً.' : e instanceof ServerError && e.code === 'not_verified' ? 'لا يُعتمد مزود لم تُتحقق مجانيته.' : 'تعذّر الحفظ.')
    }
  }
  const f = p.free
  return (
    <article className="panel ai-provider" data-state={p.approved ? 'on' : f.status}>
      <header className="admin-card-head">
        <h3 className="grow">{p.name}</h3>
        <span className={p.approved ? 'pill ok' : f.status === 'blocked' ? 'pill bad' : 'pill'}>{p.approved ? 'معتمد ومفعّل' : f.status === 'verified' ? 'متحقق من مجانيته، غير معتمد' : f.status === 'blocked' ? 'محظور' : 'غير متحقق، معطّل'}</span>
      </header>
      <p className="muted small">
        {num(p.keys)} مفاتيح · تحقق {f.checked}
        {f.source && (
          <>
            {' · '}
            <a href={f.source} target="_blank" rel="noreferrer">
              المصدر الرسمي
            </a>
          </>
        )}
      </p>
      {f.reason && <p className="insight">{f.reason}</p>}
      {f.status === 'verified' && (
        <dl className="ai-facts">
          <dt>البطاقة</dt>
          <dd>{f.card}</dd>
          <dt>الفوترة</dt>
          <dd>{f.billing}</dd>
          <dt>الحدود</dt>
          <dd>{f.limits}</dd>
          <dt>الحصة تُحسب على</dt>
          <dd>{{ project: 'المشروع (مفاتيحه حصة واحدة)', account: 'الحساب (كل مفاتيحه حصة واحدة)', key: 'المفتاح' }[f.quota ?? ''] ?? '—'}</dd>
          <dt>البيانات</dt>
          <dd>{f.data}</dd>
          <dt>العمر</dt>
          <dd>{f.age}</dd>
          <dt>الاستخدام</dt>
          <dd>{f.use}</dd>
          <dt>النماذج المجانية</dt>
          <dd>
            {p.models.map((m) => (
              <bdi key={m.id} className="pill">
                {m.id}
                {m.vision ? ' · يقرأ الصور' : ''}
              </bdi>
            ))}
          </dd>
        </dl>
      )}
      {f.status === 'verified' &&
        (p.approved ? (
          <button className="btn btn-sm" onClick={() => void set(false)}>
            إيقاف المزود
          </button>
        ) : !open ? (
          <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            اعتماد المزود…
          </button>
        ) : (
          <div className="form">
            <p className="muted">لا يُستخدم المزود في رفيق إلا بعد تأكيد كل ما يلي:</p>
            {Object.entries(p.confirm ?? {}).map(([k, label]) => (
              <label key={k} className="check-row">
                <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} /> {label}
              </label>
            ))}
            <div className="btn-row">
              <button className="btn btn-sm btn-primary" disabled={!Object.keys(p.confirm ?? {}).every((k) => checks[k])} onClick={() => void set(true)}>
                اعتماد
              </button>
              <button className="btn btn-sm" onClick={() => setOpen(false)}>
                إلغاء
              </button>
            </div>
          </div>
        ))}
    </article>
  )
}

function AddKey({ providers, onDone }: { providers: Provider[]; onDone: () => void }) {
  const [f, setF] = useState({ provider: 'gemini', label: '', owner: 'unassigned', project: '', key: '' })
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/admin/ai/keys', { body: f })
      // القيمة لا تبقى في الصفحة بعد الحفظ
      setF({ ...f, label: '', key: '' })
      toast('حُفظ المفتاح مشفراً.')
      onDone()
    } catch (x) {
      toast(x instanceof ServerError && x.code === 'bad_key' ? 'صيغة المفتاح غير صحيحة.' : x instanceof ServerError && x.code === 'cloudflare_account' ? 'لمفتاح Cloudflare اكتب معرّف الحساب (32 حرفاً) في خانة المشروع.' : x instanceof ServerError && x.code === 'keys_secret' ? 'الخادم يحتاج إلى KEYS_SECRET.' : 'تعذّر الحفظ.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="panel form" onSubmit={submit} autoComplete="off">
      <h3 className="mini-h">
        <Plus aria-hidden="true" /> إضافة مفتاح
      </h3>
      <div className="grid-2">
        <label className="field">
          <span>المزود</span>
          <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.free.status !== 'verified' ? ' (غير مفعّل)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>اسم تعريفي</span>
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required maxLength={60} />
        </label>
        <label className="field">
          <span>المجموعة (للتنظيم فقط)</span>
          <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
            {Object.entries(OWNER).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{f.provider === 'cloudflare' ? 'معرّف حساب Cloudflare' : 'المشروع أو الحساب (وحدة الحصة)'}</span>
          <input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} maxLength={80} placeholder="مثل: gemini-project-1" dir="ltr" />
        </label>
      </div>
      <label className="field">
        <span>المفتاح (يُشفّر في الخادم ولا يُعرض مرة أخرى)</span>
        <input type="password" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} required autoComplete="new-password" dir="ltr" spellCheck={false} />
      </label>
      <p className="muted small">مفاتيح المشروع الواحد حصة واحدة. اترك المشروع فارغاً إن لم تعرفه، فتُعامل كل مفاتيح المزود الفارغة حصة واحدة.</p>
      <button className="btn btn-primary" disabled={busy}>
        {busy && <LoaderCircle className="spin" aria-hidden="true" />} حفظ مشفراً
      </button>
    </form>
  )
}

function KeyRow({ k, providers, onDone }: { k: Key; providers: Provider[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const patch = async (body: Partial<Key>) => {
    try {
      await api(`/admin/ai/keys/${encodeURIComponent(k.id)}`, { method: 'PATCH', body })
      onDone()
    } catch {
      toast('تعذّر الحفظ.')
    }
  }
  const test = async () => {
    if (!confirm('الاختبار يرسل طلباً حقيقياً واحداً صغيراً إلى المزود ويستهلك من حصته المجانية. لا تشغّله إلا إذا تأكدت أن الفوترة غير مفعّلة. متابعة؟')) return
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; code?: string; ms: number; model?: string }>(`/admin/ai/keys/${encodeURIComponent(k.id)}/test`, { method: 'POST' })
      toast(r.ok ? `يعمل (${num(r.ms)} م.ث، ${r.model})` : `فشل: ${ERR[r.code ?? ''] ?? r.code}`)
      onDone()
    } catch (e) {
      toast(e instanceof ServerError && e.code === 'not_approved' ? 'اعتمد المزود أولاً.' : 'تعذّر الاختبار.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirm(`حذف «${k.label}» نهائياً من رفيق؟ (لا يُلغى من حساب المزود)`)) return
    await api(`/admin/ai/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE' }).then(onDone, () => toast('تعذّر الحذف.'))
  }
  return (
    <tr data-enabled={k.enabled}>
      <td>
        <bdi>{k.label}</bdi>
        <br />
        <small className="muted" dir="ltr">
          {k.hint} · {k.source === 'env' ? 'من أسرار الخادم' : 'مضاف من اللوحة'}
        </small>
      </td>
      <td>{providers.find((p) => p.id === k.provider)?.name ?? k.provider}</td>
      <td>
        <select value={k.owner} onChange={(e) => void patch({ owner: e.target.value })} aria-label="المجموعة">
          {Object.entries(OWNER).map(([o, v]) => (
            <option key={o} value={o}>
              {v}
            </option>
          ))}
        </select>
      </td>
      <td>
        {k.provider === 'cloudflare' ? (
          <bdi>{k.project}</bdi>
        ) : (
          <input defaultValue={k.project} placeholder="غير محدد" dir="ltr" onBlur={(e) => e.target.value !== k.project && void patch({ project: e.target.value })} aria-label="المشروع" />
        )}
      </td>
      <td>
        <span className={k.status === 'ok' ? 'pill ok' : k.status === 'auth' || k.status === 'error' ? 'pill bad' : 'pill'}>{STATUS[k.status] ?? k.status}</span>
        {k.lastError && (
          <small className="muted">
            <br />
            آخر خطأ: {ERR[k.lastError] ?? k.lastError} · {when(k.lastErrorAt)}
          </small>
        )}
      </td>
      <td>{when(k.lastUsed)}</td>
      <td className="ai-actions">
        <label className="check-row">
          <input type="checkbox" checked={k.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} /> مفعّل
        </label>
        <button className="btn btn-sm" disabled={busy} onClick={() => void test()}>
          {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Zap aria-hidden="true" />} اختبار
        </button>
        {k.source === 'db' && (
          <button className="icon-btn" onClick={() => void remove()} aria-label="حذف">
            <Trash2 />
          </button>
        )}
      </td>
    </tr>
  )
}

/** إدارة المجموعة المشتركة لمفاتيح الذكاء الاصطناعي */
export function AdminAI() {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const reload = () => setN((x) => x + 1)
  useEffect(() => {
    api<Data>('/admin/ai').then(setD, (e) => setErr(e instanceof ServerError && e.code === 'no_db' ? 'إدارة المفاتيح تحتاج إلى قاعدة بيانات الخادم.' : 'تعذّر التحميل.'))
  }, [n])
  if (err) return <p className="warn">{err}</p>
  if (!d) return <p className="page-loading">جارٍ التحميل…</p>
  const active = d.keys.filter((k) => k.enabled && d.providers.find((p) => p.id === k.provider)?.approved)
  const failing = d.keys.filter((k) => k.status === 'auth' || k.status === 'error')
  const keyName = (id: string) => d.keys.find((k) => k.id === id)?.label ?? id
  return (
    <div className="page">
      <header className="page-head">
        <h1>
          <KeyRound aria-hidden="true" /> الذكاء الاصطناعي: المجموعة المشتركة
        </h1>
        <button className="btn btn-sm" onClick={reload}>
          <RefreshCw aria-hidden="true" /> تحديث
        </button>
      </header>
      <p className="muted">كل المفاتيح المفعّلة لمزود معتمد متاحة لكل المستخدمين المصرح لهم. مفاتيح المشروع الواحد حصة واحدة، وعند نفاد حصة مشروع ينتقل رفيق إلى مزود مجاني آخر، لا إلى مشروع آخر للمزود نفسه. لا يُستخدم أي نموذج مدفوع.</p>
      <div className="stats">
        <div className="stat">
          <span className="stat-v">{num(d.keys.length)}</span>
          <span className="stat-l">كل المفاتيح</span>
        </div>
        <div className="stat">
          <span className="stat-v">{num(active.length)}</span>
          <span className="stat-l">قيد الاستخدام</span>
          <small className="muted">مفعّلة لمزود معتمد</small>
        </div>
        <div className="stat">
          <span className="stat-v">{num(d.keys.filter((k) => !k.enabled).length)}</span>
          <span className="stat-l">معطّلة</span>
        </div>
        <div className="stat">
          <span className="stat-v">{num(failing.length)}</span>
          <span className="stat-l">بها أخطاء</span>
        </div>
        <div className="stat">
          <span className="stat-v">{num(d.usage.today.requests)}</span>
          <span className="stat-l">طلبات اليوم</span>
        </div>
        <div className="stat">
          <span className="stat-v">{num(d.usage.week.requests)}</span>
          <span className="stat-l">آخر 7 أيام</span>
          <small className="muted">الرموز: {tokens(d.usage.week)}</small>
        </div>
      </div>
      {!d.providers.some((p) => p.approved) && (
        <p className="insight">
          <ShieldAlert aria-hidden="true" /> لا مزود معتمداً بعد، فخدمة الذكاء الاصطناعي متوقفة. اعتمد مزوداً بعد التأكد من شروطه.
        </p>
      )}
      {!!failing.length && (
        <p className="insight">
          <ShieldAlert aria-hidden="true" /> مفاتيح تحتاج انتباهك: {failing.map((k) => k.label).join('، ')}. المفتاح غير الصالح لا يُعاد تجريبه تلقائياً.
        </p>
      )}

      <h2 className="mini-h">المزودون</h2>
      <div className="admin-grid">
        {d.providers.map((p) => (
          <ProviderCard key={p.id} p={p} onDone={reload} />
        ))}
      </div>

      <section className="panel">
        <h3 className="mini-h">الحصص حسب المشروع أو الحساب</h3>
        <ul className="admin-list">
          {d.projects.map((p) => (
            <li key={`${p.provider}/${p.project}`}>
              <bdi className="grow">
                {d.providers.find((x) => x.id === p.provider)?.name} · {p.project || 'مشروع غير محدد'}
              </bdi>
              <small className="muted">
                {num(p.keys)} مفاتيح · اليوم {num(p.today.requests)} طلب
                {p.quota.limit ? ` من ${num(p.quota.limit)}` : ''}
              </small>
              <span className={p.quota.state === 'available' ? 'pill ok' : p.quota.state === 'exhausted' ? 'pill bad' : 'pill'}>
                {QUOTA[p.quota.state]}
                {p.quota.until ? ` حتى ${when(p.quota.until)}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">«غير معروف»: المزود لا ينشر رقم الحد ولا يعيد الاستهلاك المتبقي، فلا تُخترع أرقام.</p>
      </section>

      <section className="panel">
        <h3 className="mini-h">المفاتيح</h3>
        <div className="table-wrap">
          <table className="admin-table ai-keys">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>المزود</th>
                <th>المجموعة</th>
                <th>المشروع</th>
                <th>الحالة</th>
                <th>آخر استخدام</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {d.keys.map((k) => (
                <KeyRow key={k.id} k={k} providers={d.providers} onDone={reload} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {d.canAdd ? <AddKey providers={d.providers} onDone={reload} /> : <p className="warn">إضافة المفاتيح من اللوحة تحتاج إلى KEYS_SECRET في أسرار الخادم.</p>}

      <p className="insight">الاستهلاك حسب المستخدم إحصاء فقط: المفاتيح مشتركة، ولا حصة مخصصة لمحمد أو أمنة.</p>
      <div className="admin-grid">
        <Usage title="حسب المستخدم (7 أيام)" rows={d.usage.byUser} />
        <Usage title="حسب المزود" rows={d.usage.byProvider} nameOf={(n) => d.providers.find((p) => p.id === n)?.name ?? n} />
        <Usage title="حسب النموذج" rows={d.usage.byModel} />
        <Usage title="حسب المفتاح" rows={d.usage.byKey} nameOf={keyName} />
        <Usage title="حسب المشروع" rows={d.usage.byProject} nameOf={(n) => n || 'مشروع غير محدد'} />
      </div>

      <section className="panel">
        <h3 className="mini-h">سجل الأخطاء</h3>
        {!d.errors.length && (
          <p className="muted">
            <CircleCheck aria-hidden="true" /> لا أخطاء.
          </p>
        )}
        <ul className="admin-list">
          {d.errors.slice(0, 50).map((e, i) => (
            <li key={i}>
              <CircleX aria-hidden="true" className="err-icon" />
              <span className="grow">
                {ERR[e.code] ?? e.code} · <bdi>{keyName(e.key_id)}</bdi>
              </span>
              <small className="muted">
                {e.status ? `HTTP ${e.status} · ` : ''}
                {when(e.at)}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
