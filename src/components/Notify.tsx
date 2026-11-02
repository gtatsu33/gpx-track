import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Kind = 'info' | 'error'
type NotifyFn = (msg: string, kind?: Kind) => void

const NotifyContext = createContext<NotifyFn>(() => {})

export function useNotify(): NotifyFn {
  return useContext(NotifyContext)
}

/** 画面上部に数秒だけ出る通知 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: Kind } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const notify = useCallback<NotifyFn>((msg, kind = 'info') => {
    setToast({ msg, kind })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 3500)
  }, [])

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </NotifyContext.Provider>
  )
}
