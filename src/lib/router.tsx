import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

/** Minimal path router (History API). Routes are real URLs, so every page is linkable. */

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

const getSnapshot = () => window.location.pathname + window.location.search

export function useLocation() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const url = new URL(snapshot, window.location.origin)
  return { pathname: url.pathname, search: url.searchParams }
}

export function navigate(to: string) {
  if (to === getSnapshot()) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo({ top: 0 })
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  children: ReactNode
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
