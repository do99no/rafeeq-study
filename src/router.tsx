import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react'

/** توجيه خفيف عبر hash: يعمل على أي استضافة ثابتة دون إعدادات. */
const subscribe = (l: () => void) => {
  addEventListener('hashchange', l)
  return () => removeEventListener('hashchange', l)
}
const read = () => location.hash.slice(1) || '/'

export const usePath = () => useSyncExternalStore(subscribe, read)
export const go = (path: string) => {
  location.hash = path
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={`#${to}`} {...rest} />
}
