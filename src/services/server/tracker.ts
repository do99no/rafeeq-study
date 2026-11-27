import { useSyncExternalStore } from 'react'
import { load, remove, save } from '../storage/local'
import { api, getAccount } from './account'

/**
 * وقت الدراسة الفعلي. يُحتسب الوقت نشطاً فقط إذا اجتمعت أربعة شروط:
 * الصفحة مرئية، والطالب داخل الدراسة (دفتر أو قارئ أو مراجعة)، وتفاعل حديث أقل من مهلة الخمول، واتصال قائم بالخادم.
 * لا يُسجَّل ما يكتبه الطالب ولا ضغطات المفاتيح: الحدث يحدّث وقت آخر تفاعل فقط.
 */
export interface StudyContext {
  subject?: string
  bookId?: string
  book?: string
  lesson?: string
}
export type StudyTask = 'explain' | 'teach' | 'check' | 'summary' | 'quiz' | 'cards' | 'read' | 'answer' | 'review' | 'other'
type Pause = 'hidden' | 'idle' | 'offline' | null

const TICK = 1000
const BEAT = 30_000
/** غياب طويل ينهي الجلسة؛ العودة بعده تبدأ جلسة مرتبطة بالسابقة */
const END_AFTER = 30 * 60_000

let idleMs = 2 * 60_000
let studying = false
let ctx: StudyContext = {}
let task: StudyTask = 'other'
let lastActivity = Date.now()
let lastTick = Date.now()
let session: { id: string; seq: number } | null = null
let prevId: string | null = null
let prevEnd = 0
let pause: Pause = null
let pausedSince = 0
let serverOk = true
let acc = { activeMs: 0, pausedMs: 0, hidden: 0, returns: 0, offline: 0, idle: 0 }
let totalToday = 0
let started = false

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
/** للواجهة: هل يُحتسب الوقت الآن، ولماذا توقف */
export const useTracker = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => (session ? (pause ?? 'active') : 'off') as 'active' | 'off' | Exclude<Pause, null>,
  )

const isStudent = () => getAccount().session?.user.role === 'student'
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// ===== سجل النشاط: أحداث تعليمية فقط، تُحفظ محلياً إن انقطع الاتصال =====
interface Ev extends StudyContext {
  type: string
  at: number
  detail?: string
  session?: string
  queued?: boolean
}
const QKEY = 'events-queue'
let queue: Ev[] = load<Ev[]>(QKEY) ?? []
let flushing = false
export function logEvent(type: string, detail?: string, extra: StudyContext = {}) {
  if (!isStudent()) return
  queue.push({ type, at: Date.now(), ...ctx, ...extra, ...(detail ? { detail: detail.slice(0, 300) } : {}), session: session?.id })
  if (queue.length > 500) queue = queue.slice(-500)
  save(QKEY, queue)
  if (queue.length >= 20) void flushEvents()
}
async function flushEvents(keepalive = false) {
  if (flushing || !queue.length || !isStudent()) return
  flushing = true
  const batch = queue.slice(0, 50)
  try {
    await api('/track/events', { body: { events: batch }, keepalive })
    queue = queue.slice(batch.length)
    save(QKEY, queue)
  } catch {
    // ما لم يصل يُعلَّم مؤجلاً ويُعاد لاحقاً
    queue = queue.map((e) => ({ ...e, queued: true }))
    save(QKEY, queue)
  } finally {
    flushing = false
  }
}

// ===== الجلسة =====
async function startSession() {
  if (session || !isStudent()) return
  const id = rid()
  session = { id, seq: 0 }
  acc = { activeMs: 0, pausedMs: 0, hidden: 0, returns: 0, offline: 0, idle: 0 }
  const linked = prevId && Date.now() - prevEnd < END_AFTER ? prevId : null
  save('study-session', { id, at: Date.now() })
  emit()
  try {
    await api('/track/start', { body: { id, prevId: linked, context: ctx } })
    serverOk = true
  } catch {
    serverOk = false
  }
  logEvent(linked ? 'visible' : 'session_start', linked ? 'عاد إلى الدراسة' : undefined)
}

async function sendBeat(final?: string) {
  if (!session) return
  const s = session
  const body = { id: s.id, seq: ++s.seq, ...acc, task, context: ctx, ...(final ? { reason: final } : {}) }
  const sent = acc
  acc = { activeMs: 0, pausedMs: 0, hidden: 0, returns: 0, offline: 0, idle: 0 }
  try {
    await api(final ? '/track/end' : '/track/beat', { body, keepalive: !!final })
    if (!serverOk) {
      serverOk = true
      logEvent('online')
    }
  } catch {
    // لم تصل: تُضم إلى النبضة التالية، والوقت لا يُحتسب حتى يعود الاتصال
    acc = { activeMs: acc.activeMs + sent.activeMs, pausedMs: acc.pausedMs + sent.pausedMs, hidden: acc.hidden + sent.hidden, returns: acc.returns + sent.returns, offline: acc.offline + sent.offline, idle: acc.idle + sent.idle }
    s.seq--
    if (serverOk) {
      serverOk = false
      acc.offline++
      logEvent('offline', 'انقطع الاتصال بالخادم')
    }
  }
}

function endSession(reason: 'left' | 'logout' | 'pagehide' | 'idle' | 'hidden') {
  if (!session) return
  const id = session.id
  if (reason !== 'logout') logEvent(reason === 'pagehide' ? 'pagehide' : 'session_end', { left: 'غادر الدراسة', pagehide: 'غادر الموقع أو أغلق الصفحة', idle: 'خمول طويل', hidden: 'صفحة الدراسة مخفية مدة طويلة' }[reason])
  void sendBeat(reason)
  prevId = id
  prevEnd = Date.now()
  session = null
  pause = null
  remove('study-session')
  void flushEvents(reason === 'pagehide' || reason === 'logout')
  emit()
}

function setPause(p: Pause) {
  if (p === pause) return
  const now = Date.now()
  if (p && !pause) {
    pausedSince = now
    if (p === 'hidden') {
      acc.hidden++
      logEvent('hidden', 'أخفى صفحة الدراسة أو انتقل إلى تبويب آخر')
    } else if (p === 'idle') {
      acc.idle++
      logEvent('idle', 'توقف عن التفاعل')
    }
  } else if (!p && pause) {
    acc.returns++
    logEvent('active', pause === 'hidden' ? 'عاد إلى صفحة الدراسة' : pause === 'idle' ? 'عاد إلى التفاعل' : 'عاد الاتصال')
  }
  pause = p
  emit()
}

function tick() {
  const now = Date.now()
  const dt = Math.min(now - lastTick, 5 * TICK)
  lastTick = now
  if (!isStudent()) return
  if (!studying) return session && endSession('left')
  const visible = document.visibilityState === 'visible'
  const online = navigator.onLine && serverOk
  const p: Pause = !visible ? 'hidden' : !online ? 'offline' : now - lastActivity > idleMs ? 'idle' : null
  if (!session) {
    // الجلسة تبدأ بنشاط حقيقي داخل الدراسة
    if (visible && now - lastActivity < idleMs) void startSession()
    return
  }
  setPause(p)
  if (p) {
    acc.pausedMs += dt
    if ((p === 'hidden' || p === 'idle') && now - pausedSince > END_AFTER) endSession(p)
  } else {
    acc.activeMs += dt
    totalToday += dt
  }
}

/** تفاعل حقيقي: نقرة أو لمس أو كتابة أو تمرير (دون تسجيل محتواها) */
export function activity() {
  lastActivity = Date.now()
}
export function setStudying(on: boolean, context?: StudyContext) {
  studying = on
  if (context) setContext(context)
  if (on) activity()
}
export function setContext(c: StudyContext) {
  ctx = { ...ctx, ...c }
}
export function setTask(t: StudyTask) {
  task = t
  activity()
}
export const setIdleMinutes = (m: number) => (idleMs = Math.max(1, Math.min(m, 30)) * 60_000)
export const todayActiveMs = () => totalToday
export const setTodayBase = (ms: number) => (totalToday = ms)

export function stopTracking(reason: 'logout') {
  endSession(reason)
}

export function startTracking() {
  if (started) return
  started = true
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) addEventListener(e, activity, { passive: true, capture: true })
  setInterval(tick, TICK)
  setInterval(() => {
    if (session) void sendBeat()
    void flushEvents()
  }, BEAT)
  addEventListener('online', () => void flushEvents())
  addEventListener('offline', () => {
    if (session && serverOk) {
      serverOk = false
      acc.offline++
      logEvent('offline', 'انقطع الإنترنت')
    }
  })
  // إغلاق الصفحة أو الانتقال إلى موقع آخر: لا يمكن التمييز بينهما بدقة، فيُسجلان معاً «مغادرة الموقع»
  addEventListener('pagehide', () => endSession('pagehide'))
  // عند عودة الاتصال: نبضة فورية تتحقق من الجلسة قبل استئناف الاحتساب
  addEventListener('online', () => session && void sendBeat())
}
