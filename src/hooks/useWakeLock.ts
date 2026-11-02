import { useEffect, useState } from 'react'

export type WakeLockStatus = 'active' | 'unsupported' | 'failed' | 'released'

/** 画面を点けたままにする（Screen Wake Lock API）。非表示→表示で取り直す */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [status, setStatus] = useState<WakeLockStatus>(supported ? 'released' : 'unsupported')

  useEffect(() => {
    if (!enabled || !supported) return
    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const s = await navigator.wakeLock.request('screen')
        if (disposed) {
          void s.release()
          return
        }
        sentinel = s
        setStatus('active')
        s.addEventListener('release', () => {
          if (!disposed) setStatus('released')
        })
      } catch {
        setStatus('failed')
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release()
    }
  }, [enabled, supported])

  return status
}
