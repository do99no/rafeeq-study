import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { num } from '../lib/format'
import { coolingUntil, ERROR_TEXT, providers, refresh, setConfig, useAI } from '../services/ai/manager'
import { TASK_LABEL, type Task } from '../services/ai/types'

const time = (t: number) => new Date(t).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })

/** حالة الخدمات بلغة الطالب. لا تُعرض ولا تُطلب مفاتيح API هنا. */
export function ServicesPanel() {
  const { config, health, service } = useAI()
  const [url, setUrl] = useState(config.url)
  const [code, setCode] = useState(config.code)
  const list = providers()
  const ids = list.map((p) => p.info.id)

  const move = (id: string, by: number) => {
    const order = [...ids, ...config.order.filter((x) => !ids.includes(x))]
    const i = order.indexOf(id)
    const j = i + by
    if (j < 0 || j >= ids.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    setConfig({ order })
  }

  const state =
    service.state === 'ok' ? 'متصلة' : service.state === 'checking' ? 'جارٍ الفحص…' : service.state === 'error' ? ERROR_TEXT[service.code!] : 'غير مفعّلة'

  return (
    <section className="panel">
      <div className="section-head">
        <h2>الذكاء الاصطناعي</h2>
        <span className="status" data-status={service.state === 'ok' ? 'ready' : service.state === 'error' ? 'error' : 'pending'}>
          {state}
        </span>
      </div>
      <p className="muted">عند تعطل خدمة أو انتهاء حصتها ينتقل رفيق إلى التالية. يُرسل سؤالك والفقرات المرتبطة به فقط، دون اسمك. بعض الخدمات المجانية قد تستخدم المحتوى لتحسين نماذجها.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          setConfig({ url: url.trim(), code: code.trim() })
          void refresh(true)
        }}
      >
        <label className="field">
          <span>رمز الوصول</span>
          <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="الرمز الذي اختاره صاحب المشروع" />
        </label>
        <label className="field">
          <span>عنوان الخدمة</span>
          <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
        <div className="btn-row">
          <button className="btn btn-primary">حفظ وفحص</button>
          <button type="button" className="btn" onClick={() => void refresh(true)}>
            <RotateCcw aria-hidden="true" /> إعادة الفحص
          </button>
        </div>
      </form>

      <ul className="providers">
        {list.map((p, i) => {
          const { id, name, note, configured, models } = p.info
          const tasks = Object.keys(models) as Task[]
          const hs = tasks.map((t) => ({ t, h: health[`${id}:${t}`] }))
          const bad = hs.find((x) => x.h && !x.h.ok && coolingUntil(`${id}:${x.t}`))
          const until = bad ? coolingUntil(`${id}:${bad.t}`) : 0
          const on = !config.off.includes(id)
          const good = hs.some((x) => x.h?.ok)
          const today = new Date().toISOString().slice(0, 10)
          const used = hs.reduce((s, x) => s + (x.h?.day === today ? (x.h.used ?? 0) : 0), 0)
          const text = !configured ? (id === 'ollama' ? 'غير مفعّل' : 'لم يُضف مفتاح') : !on ? 'متوقف' : bad ? ERROR_TEXT[bad.h!.code!] : good ? 'يعمل' : 'جاهز، لم يُجرَّب'
          return (
            <li key={id} className="provider">
              <span className="provider-order">
                <button className="icon-btn" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`رفع أولوية ${name}`}>
                  <ChevronUp />
                </button>
                <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(id, 1)} aria-label={`خفض أولوية ${name}`}>
                  <ChevronDown />
                </button>
              </span>
              <div className="grow">
                <strong>
                  {num(i + 1)}. {name}
                </strong>
                {tasks.length > 0 && <p className="muted">{tasks.map((t) => TASK_LABEL[t]).join('، ')}</p>}
                {models.chat && (
                  <p className="muted">
                    <bdi dir="ltr">{models.chat}</bdi>
                  </p>
                )}
                {configured && <p className="muted">طلبات اليوم من هذا الجهاز: {num(used)}. الحصة المتبقية غير معلنة.</p>}
                {bad && bad.h!.code !== 'auth' && until > 0 && <p className="muted">يعاد تجريبه بعد {time(until)}</p>}
                {note && <p className="muted">{note}</p>}
                {configured && (
                  <label className="check-row">
                    <input type="checkbox" checked={on} onChange={(e) => setConfig({ off: e.target.checked ? config.off.filter((x) => x !== id) : [...config.off, id] })} />
                    استخدام هذه الخدمة
                  </label>
                )}
              </div>
              <span className="status" data-status={!configured || !on ? 'pending' : bad ? 'error' : good ? 'ready' : 'pending'}>
                {text}
              </span>
            </li>
          )
        })}
      </ul>
      <details>
        <summary>تشغيل محلي عبر Ollama</summary>
        <div className="form ollama">
          <label className="check-row">
            <input type="checkbox" checked={config.ollama.on} onChange={(e) => setConfig({ ollama: { ...config.ollama, on: e.target.checked } })} />
            تفعيل Ollama على هذا الجهاز
          </label>
          <label className="field">
            <span>نموذج الإجابة</span>
            <input dir="ltr" value={config.ollama.model} onChange={(e) => setConfig({ ollama: { ...config.ollama, model: e.target.value.trim() } })} />
          </label>
          <label className="field">
            <span>نموذج البحث الدلالي (اختياري)</span>
            <input dir="ltr" value={config.ollama.embedModel} onChange={(e) => setConfig({ ollama: { ...config.ollama, embedModel: e.target.value.trim() } })} />
          </label>
        </div>
      </details>
    </section>
  )
}
