import { useEffect, useRef, useState } from 'react'
import { createSimulator, readSimParams } from '../dev/gpsSimulator'
import type { ControlLine, Fix } from '../lib/types'

export type GeoStatus = 'starting' | 'ok' | 'denied' | 'unavailable' | 'unsupported' | 'simulated'

/**
 * 端末の位置を取り続ける（watchPosition、高精度）。
 * URL に ?sim があるときは疑似GPSを1秒ごとに流す。
 */
export function useGeolocation(enabled: boolean, line: ControlLine | null, onFix: (f: Fix) => void) {
  const [status, setStatus] = useState<GeoStatus>('starting')
  const cb = useRef(onFix)
  cb.current = onFix
  const lineRef = useRef(line)
  lineRef.current = line
  const lineKey = line ? `${line.a.lat},${line.a.lng},${line.b.lat},${line.b.lng}` : ''

  useEffect(() => {
    if (!enabled) return
    const sim = readSimParams()
    if (sim) {
      setStatus('simulated')
      const gen = createSimulator(sim, lineRef.current, Date.now())
      const id = window.setInterval(() => cb.current(gen(Date.now())), 1000)
      return () => window.clearInterval(id)
    }
    if (!('geolocation' in navigator)) {
      setStatus('unsupported')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('ok')
        cb.current({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          t: pos.timestamp,
          acc: pos.coords.accuracy,
          speed: pos.coords.speed,
        })
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
    // 疑似GPSはライン変更時に作り直す
  }, [enabled, lineKey])

  return status
}
