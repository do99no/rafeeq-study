import { useSyncExternalStore } from 'react'
import { actions, onDataChange } from '../../store/store'
import type { StudentData } from '../../types'
import { load, save } from '../storage/local'
import { api, getAccount, logout, onSessionEnd, serverLibraryCode, type User } from './account'
import { pull, startSync } from './sync'
import { logEvent, setIdleMinutes, setTask, setTodayBase, startTracking, stopTracking } from './tracker'

/** خطة الطالب كما حددها المسؤول، ليعرف أهدافه */
export interface StudentPlan {
  dailyMin: number
  weeklyMin: number
  weeklyQuizzes: number
  idleMin: number
  reviewWeak: boolean
  examDate?: string
  reviewDates: { date: string; note: string }[]
  note: string
  lessons: { key: string; title: string; book?: string; due?: string }[]
}
let plan: { plan: StudentPlan | null; todayMs: number } | null = null
const listeners = new Set<() => void>()
export const usePlan = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => plan,
  )
export async function loadPlan() {
  try {
    plan = await api<{ plan: StudentPlan | null; todayMs: number }>('/plan')
    if (plan.plan?.idleMin) setIdleMinutes(plan.plan.idleMin)
    setTodayBase(plan.todayMs)
    listeners.forEach((l) => l())
  } catch {
    /* دون اتصال: تبقى الخطة السابقة */
  }
}

/** بعد الدخول أو عند فتح التطبيق بجلسة طالب محفوظة */
export async function beginStudent(user: User): Promise<{ empty: boolean }> {
  actions.enterAccount(user)
  startSync()
  startTracking()
  wireActivity()
  void loadPlan()
  // رمز المكتبة من أسرار الخادم (إن أُعد): لا يحتاج الطالب إلى كتابته
  void serverLibraryCode()
    .then((code) => code && !load<string>('library-code') && save('library-code', code))
    .catch(() => {})
  try {
    return { empty: !(await pull()) }
  } catch {
    return { empty: false }
  }
}

/** الخروج: تُغلق جلسة الدراسة أولاً (والرمز ما زال صالحاً)، ثم تُمسح بيانات الطالب من الجهاز */
export async function signOut() {
  if (getAccount().session?.user.role === 'student') {
    logEvent('logout')
    stopTracking('logout')
  }
  await logout()
}
onSessionEnd(() => {
  plan = null
  actions.leaveAccount()
})

/** أحداث السجل التعليمي من تغيّرات البيانات نفسها (لا من مراقبة الطالب) */
let wired = false
const lastCards: Record<string, number> = {}
function wireActivity() {
  if (wired) return
  wired = true
  onDataChange((a: StudentData, b: StudentData) => {
    if (getAccount().session?.user.role !== 'student') return
    const titleOf = (id: string) => b.books.find((x) => x.id === id)
    for (const n of b.notebooks) {
      const old = a.notebooks.find((x) => x.id === n.id)
      if (n.focus && (n.focus.title !== old?.focus?.title || n.focus.bookId !== old?.focus?.bookId)) {
        const book = titleOf(n.focus.bookId)
        const seen = Object.values(a.studied).some((s) => s.bookId === n.focus!.bookId) || a.notebooks.some((x) => x.focus?.bookId === n.focus!.bookId)
        if (!seen) logEvent('book_start', undefined, { book: book?.title, bookId: book?.id, subject: book?.subject })
        logEvent('lesson_open', undefined, { book: book?.title, bookId: book?.id, subject: book?.subject, lesson: n.focus.title })
      }
    }
    for (const o of b.outputs.filter((x) => !a.outputs.some((y) => y.id === x.id))) {
      if (o.data.kind === 'summary') logEvent('summary', o.title)
      else if (o.data.kind === 'cards') logEvent('cards', o.title)
    }
    for (const t of b.attempts.filter((x) => !a.attempts.some((y) => y.id === x.id))) {
      const o = b.outputs.find((x) => x.id === t.outputId)
      logEvent('quiz_done', `${t.score}/${t.total} · ${o?.title ?? ''}`)
    }
    for (const o of b.outputs) {
      const old = a.outputs.find((x) => x.id === o.id)
      if (o.data.kind === 'cards' && old?.data.kind === 'cards' && old.data !== o.data && Date.now() - (lastCards[o.id] ?? 0) > 5 * 60_000) {
        lastCards[o.id] = Date.now()
        setTask('cards')
        logEvent('cards_review', o.title)
      }
    }
    for (const [chat, list] of Object.entries(b.messages)) {
      const before = a.messages[chat] ?? []
      for (const m of list) {
        const prev = before.find((x) => x.id === m.id)
        if (m.role !== 'assistant' || !m.verdict || prev?.verdict === m.verdict || m.verdict === 'skipped') continue
        logEvent(m.verdict === 'correct' ? 'answer_right' : m.verdict === 'partial' ? 'answer_partial' : 'answer_wrong')
      }
      for (const m of list.filter((x) => !before.some((y) => y.id === x.id) && x.role === 'assistant' && x.mode === 'ai')) {
        if (m.task === 'explain') logEvent('explain_done', m.part ? `الجزء ${m.part.k} من ${m.part.n}` : undefined)
      }
    }
  })
}
