import { useSyncExternalStore } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react'
import { num } from '../lib/format'
import { onReadState, pauseSpeaking, readState, replaySpeaking, resumeSpeaking, setSpeakingRate, skipSpeaking, stopSpeaking } from '../lib/speech'
import { actions } from '../store/store'

const RATES = [0.8, 0.92, 1, 1.1]

/** شريط القراءة الصوتية: يظهر أثناء القراءة فقط، ويحتفظ بموضع الجملة الحالية */
export function ReadAloudBar() {
  const s = useSyncExternalStore(onReadState, readState)
  if (!s.active) return null
  const browser = s.mode === 'browser'
  return (
    <div className="read-bar" role="region" aria-label="القراءة الصوتية">
      <button className="icon-btn" onClick={() => skipSpeaking(-1)} aria-label={browser ? 'الجملة السابقة' : 'رجوع ١٠ ثوانٍ'} title={browser ? 'الجملة السابقة' : 'رجوع ١٠ ثوانٍ'}>
        <SkipForward />
      </button>
      <button className="icon-btn read-main" onClick={() => (s.paused ? resumeSpeaking() : pauseSpeaking())} aria-label={s.paused ? 'متابعة' : 'إيقاف مؤقت'}>
        {s.paused ? <Play /> : <Pause />}
      </button>
      <button className="icon-btn" onClick={() => skipSpeaking(1)} aria-label={browser ? 'الجملة التالية' : 'تقديم ١٠ ثوانٍ'} title={browser ? 'الجملة التالية' : 'تقديم ١٠ ثوانٍ'}>
        <SkipBack />
      </button>
      <span className="read-pos grow">
        {s.title ? <strong>{s.title}</strong> : null}
        {browser && s.total > 1 ? <small className="muted">الجملة {num(s.index + 1)} من {num(s.total)}</small> : null}
      </span>
      <button className="icon-btn" onClick={replaySpeaking} aria-label="من البداية" title="من البداية">
        <RotateCcw />
      </button>
      <select
        className="read-rate"
        aria-label="سرعة القراءة"
        value={RATES.reduce((b, r) => (Math.abs(r - s.rate) < Math.abs(b - s.rate) ? r : b), RATES[1])}
        onChange={(e) => {
          const rate = Number(e.target.value)
          setSpeakingRate(rate)
          actions.setSettings({ rate })
        }}
      >
        {RATES.map((r) => (
          <option key={r} value={r}>{r === 0.92 ? 'عادية' : `${num(r)}×`}</option>
        ))}
      </select>
      <button className="icon-btn" onClick={stopSpeaking} aria-label="إيقاف القراءة">
        <X />
      </button>
    </div>
  )
}
