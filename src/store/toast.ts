import { useSyncExternalStore } from 'react'

let message = ''
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function toast(text: string) {
  message = text
  listeners.forEach((l) => l())
  clearTimeout(timer)
  if (text) timer = setTimeout(() => toast(''), 3500)
}
export const useToast = () => useSyncExternalStore(subscribe, () => message)
