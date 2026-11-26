import { useSyncExternalStore } from 'react'

/** قارئ صفحات الكتاب: نافذة واحدة تُفتح من أي استشهاد */
export interface ViewerTarget {
  bookId: string
  page: number
  /** مقتطف الاستشهاد ليراه الطالب بجانب الصفحة */
  quote?: string
}
let target: ViewerTarget | null = null
const listeners = new Set<() => void>()

export function openPage(t: ViewerTarget | null) {
  target = t
  listeners.forEach((l) => l())
}
export const useViewer = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => target,
  )
