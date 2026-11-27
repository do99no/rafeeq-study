import { useEffect, useState } from 'react'
import { Square, Volume2 } from 'lucide-react'
import { arabicVoices, bestVoice, canSpeak, speak, stopSpeaking, voices } from '../lib/speech'
import { actions, useStore } from '../store/store'

/** عينة فيها ما يصعب على القراءة الآلية: همزات وتنوين وأرقام ومعادلة ومصطلح إنجليزي */
const SAMPLE = '### مثال للاستماع\nالسرعةُ المتوسطةُ تساوي المسافةَ مقسومةً على الزمن. إذا قطعت سيارةٌ ١٢٠ كيلومتراً في ساعتين، فإن:\n- ع = ف ÷ ز = ١٢٠ ÷ ٢ = ٦٠ كم/ساعة\n- س² + ٣س − ٤ = ٠\nوتسمى هذه الحركة uniform linear motion في الكتب الإنجليزية.'

/** القراءة الصوتية: اختيار الصوت وسرعته، مع عينة للاستماع قبل الاعتماد */
export function VoiceSettings() {
  const s = useStore((x) => x.data.settings)
  const [list, setList] = useState(arabicVoices())
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!canSpeak) return
    const f = () => setList(arabicVoices())
    voices()
    speechSynthesis.addEventListener('voiceschanged', f)
    const t = setTimeout(f, 800)
    return () => (speechSynthesis.removeEventListener('voiceschanged', f), clearTimeout(t), stopSpeaking())
  }, [])
  if (!canSpeak) return null
  const current = bestVoice('ar', s.voice)
  const natural = list.some((v) => /natural|online|google/i.test(v.name))
  return (
    <section className="panel">
      <h2>القراءة الصوتية</h2>
      {list.length === 0 ? (
        <p className="muted">لا يوجد صوت عربي في هذا الجهاز أو المتصفح. على أندرويد ثبّت «خدمات Google للتحويل من نص إلى كلام» وفعّل العربية، وعلى الكمبيوتر يوفر متصفح Edge أصواتاً عربية طبيعية مجاناً.</p>
      ) : (
        <>
          <label className="field">
            <span>الصوت</span>
            <select className="input" value={current?.voiceURI ?? ''} onChange={(e) => actions.setSettings({ voice: e.target.value })}>
              {list.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){/natural|online/i.test(v.name) ? ' — طبيعي' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>السرعة: {(s.rate ?? 0.92).toLocaleString('ar', { maximumFractionDigits: 2 })}</span>
            <input type="range" min={0.7} max={1.15} step={0.05} value={s.rate ?? 0.92} onChange={(e) => actions.setSettings({ rate: Number(e.target.value) })} />
          </label>
          <button
            className="btn btn-sm"
            onClick={() => {
              if (playing) return (stopSpeaking(), setPlaying(false))
              setPlaying(true)
              speak(SAMPLE, { voice: s.voice, rate: s.rate, onEnd: () => setPlaying(false) })
            }}
          >
            {playing ? <Square aria-hidden="true" /> : <Volume2 aria-hidden="true" />} {playing ? 'إيقاف' : 'استمع إلى مثال'}
          </button>
          {!natural && <p className="hint">الأصوات في هذا الجهاز آلية النبرة. أوضح صوت عربي مجاني: الأصوات «الطبيعية» في متصفح Edge، أو صوت Google على أندرويد.</p>}
        </>
      )}
    </section>
  )
}
