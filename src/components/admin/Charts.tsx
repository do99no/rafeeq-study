import { num } from '../../lib/format'

/** مدة بالساعات والدقائق: «٢ س ١٥ د» */
export function dur(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 1) return ms > 0 ? 'أقل من دقيقة' : `${num(0)} د`
  const h = Math.floor(m / 60)
  return h ? `${num(h)} س${m % 60 ? ` ${num(m % 60)} د` : ''}` : `${num(m)} د`
}

/** أعمدة يومية: كل عمود يوم، والارتفاع وقت الدراسة الفعلي */
export function DailyBars({ data, target }: { data: { day: string; ms: number }[]; target?: number }) {
  const max = Math.max(1, target ?? 0, ...data.map((d) => d.ms))
  const W = 300, H = 120, bw = W / data.length
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="وقت الدراسة اليومي لآخر 30 يوماً">
        {target ? <line x1="0" x2={W} y1={H - (target / max) * H} y2={H - (target / max) * H} className="chart-target" /> : null}
        {data.map((d, i) => {
          const h = (d.ms / max) * H
          return (
            <rect key={d.day} x={W - (i + 1) * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} className="chart-bar">
              <title>{`${d.day}: ${dur(d.ms)}`}</title>
            </rect>
          )
        })}
        <text x={W - 2} y={H + 14} className="chart-label" textAnchor="end">
          {data[0]?.day.slice(5)}
        </text>
        <text x="2" y={H + 14} className="chart-label">
          {data.at(-1)?.day.slice(5)}
        </text>
      </svg>
      {target ? <figcaption className="muted">الخط: الهدف اليومي ({dur(target)})</figcaption> : null}
    </figure>
  )
}

/** توزيع أفقي: المادة أو الكتاب أو الدرس */
export function SplitBars({ data, empty = 'لا بيانات بعد.' }: { data: { name: string; ms: number }[]; empty?: string }) {
  const max = Math.max(1, ...data.map((d) => d.ms))
  if (!data.length) return <p className="muted">{empty}</p>
  return (
    <ul className="split">
      {data.map((d) => (
        <li key={d.name}>
          <span className="split-name">{d.name}</span>
          <span className="split-track">
            <span className="split-fill" style={{ width: `${(d.ms / max) * 100}%` }} />
          </span>
          <span className="split-val">{dur(d.ms)}</span>
        </li>
      ))}
    </ul>
  )
}

/** تطور النتائج: نقطة لكل اختبار بنسبته */
export function Trend({ data }: { data: { at: number; pct: number; title: string }[] }) {
  if (data.length < 2) return <p className="muted">{data.length ? `اختبار واحد: ${num(data[0].pct)}٪` : 'لا اختبارات بعد.'}</p>
  const W = 300, H = 110
  const pts = data.map((d, i) => [W - (i / (data.length - 1)) * W, H - (d.pct / 100) * H] as const)
  return (
    <figure className="chart">
      <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} role="img" aria-label="تطور نتائج الاختبارات">
        <line x1="0" x2={W} y1={H * 0.4} y2={H * 0.4} className="chart-target" />
        <polyline points={pts.map((p) => p.join(',')).join(' ')} className="chart-line" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3.5" className="chart-dot">
            <title>{`${data[i].title}: ${data[i].pct}%`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="muted">من الأقدم (يمين) إلى الأحدث. الخط: ٦٠٪</figcaption>
    </figure>
  )
}
