import { useState, type FormEvent } from 'react'
import { BookOpen, Eye, EyeOff, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'
import { login, ServerError, setupAdmin, refreshStatus, type Status } from '../services/server/account'
import { num } from '../lib/format'

function errorText(e: unknown) {
  if (!(e instanceof ServerError)) return 'حدث خطأ غير متوقع. حاول مرة أخرى.'
  if (e.code === 'locked') return `توقف الدخول مؤقتاً بعد محاولات خاطئة. حاول بعد ${num(Math.max(1, Math.ceil(Number(e.extra.retryAfter ?? 900) / 60)))} دقيقة.`
  if (e.code === 'network' || e.code === 'no_server') return 'تعذّر الاتصال بالخادم. تأكد من الإنترنت ثم حاول مرة أخرى.'
  if (e.code === 'weak_password') return 'كلمة المرور يجب ألا تقل عن 8 أحرف.'
  if (e.code === 'setup_code') return 'رمز الإعداد غير صحيح.'
  if (e.code === 'worker_setup') return 'الخادم يحتاج إلى إعداد أسراره أولاً.'
  return 'الاسم أو كلمة المرور غير صحيحة.'
}

function Password({ value, onChange, label, auto }: { value: string; onChange: (v: string) => void; label: string; auto: string }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field">
      <span>{label}</span>
      <span className="pw">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={auto} dir="auto" required minLength={8} maxLength={128} autoFocus />
        <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
          {show ? <EyeOff /> : <Eye />}
        </button>
      </span>
    </label>
  )
}

/** صفحة الدخول: اسما الطالبين، ثم كلمة مرور من يختار. لا إنشاء حسابات من هنا. */
export function Login({ status, onDone }: { status: Status; onDone: () => void }) {
  const [who, setWho] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const students = status.students ?? []
  const name = who === 'admin' ? 'المسؤول' : students.find((s) => s.id === who)?.name

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!who || busy) return
    setBusy(true)
    setErr('')
    try {
      await login(who, pw)
      setPw('')
      onDone()
    } catch (x) {
      setErr(errorText(x))
      setPw('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen />
          </span>
          <h1>رفيق</h1>
          <p className="muted">مساعدك الدراسي للشهادة السودانية</p>
        </div>
        {!who || !name ? (
          <>
            <h2>من يدرس الآن؟</h2>
            <div className="who">
              {students.map((s) => (
                <button key={s.id} className="who-btn" onClick={() => (setWho(s.id), setErr(''))} disabled={!s.ready}>
                  <span className="who-avatar" aria-hidden="true">
                    {s.name.slice(0, 1)}
                  </span>
                  <strong>{s.name}</strong>
                  {!s.ready && <small className="muted">لم تُحدَّد كلمة المرور بعد</small>}
                </button>
              ))}
            </div>
            <button className="text-link admin-link" onClick={() => setWho('admin')}>
              <ShieldCheck aria-hidden="true" /> دخول المسؤول
            </button>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            <h2>
              أهلاً {name}
            </h2>
            <Password value={pw} onChange={setPw} label="كلمة المرور" auto="current-password" />
            {err && (
              <p className="warn" role="alert">
                {err}
              </p>
            )}
            <button className="btn btn-primary" disabled={busy || pw.length < 8}>
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />} دخول
            </button>
            <button type="button" className="text-link" onClick={() => (setWho(null), setPw(''), setErr(''))}>
              ليس أنا
            </button>
          </form>
        )}
        <p className="login-note">يسجّل رفيق وقت دراستك الفعلي ونشاطك التعليمي (الدروس والشروح والاختبارات) ليتابع المسؤول تقدمك. لا يُسجَّل ما تكتبه على لوحة المفاتيح ولا الصوت ولا الكاميرا ولا صور الشاشة.</p>
      </div>
    </div>
  )
}

/** الإعداد الأول: إنشاء حساب المسؤول برمز الإعداد من أسرار الخادم */
export function Setup({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) return setErr('كلمتا المرور غير متطابقتين.')
    setBusy(true)
    setErr('')
    try {
      await setupAdmin(code.trim(), pw)
      await refreshStatus()
      onDone()
    } catch (x) {
      setErr(errorText(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login">
      <form className="login-card form" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck />
          </span>
          <h1>إعداد رفيق</h1>
          <p className="muted">إنشاء حساب المسؤول مرة واحدة. بعدها تحدد كلمتي مرور محمد وأمنة من لوحة المتابعة.</p>
        </div>
        <label className="field">
          <span>رمز الإعداد (من أسرار الخادم)</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" dir="ltr" />
        </label>
        <Password value={pw} onChange={setPw} label="كلمة مرور المسؤول (8 أحرف على الأقل)" auto="new-password" />
        <label className="field">
          <span>تأكيد كلمة المرور</span>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        {err && (
          <p className="warn" role="alert">
            {err}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy && <LoaderCircle className="spin" aria-hidden="true" />} إنشاء حساب المسؤول
        </button>
      </form>
    </div>
  )
}
