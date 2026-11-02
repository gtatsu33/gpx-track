// 開発用の疑似GPS（implement.txt ■10）
//   ?sim=1            コントロールライン中点を通る半径300mの円を周回（約113km/h、約60秒/周）
//   ?sim=1&speed=20   時速20kmで周回
//   ?sim=pit          ライン付近を歩く速度で往復（ラインをまたぐがカウントされないはず）
// 円の中心はライン中点からライン方向に半径分ずらした位置に置き、中点でラインを直角に横切るようにしている。
import { makeProjector, makeUnprojector, midpoint } from '../lib/geo'
import type { ControlLine, Fix } from '../lib/types'

export type SimMode = 'lap' | 'pit'

export interface SimParams {
  mode: SimMode
  speedKmh: number
}

export function readSimParams(search: string = window.location.search): SimParams | null {
  const q = new URLSearchParams(search)
  const sim = q.get('sim')
  if (!sim) return null
  const speed = Number(q.get('speed'))
  return {
    mode: sim === 'pit' ? 'pit' : 'lap',
    speedKmh: Number.isFinite(speed) && speed > 0 ? speed : 113,
  }
}

/** ラインが未設定のときの仮の場所（富士スピードウェイ付近） */
const DEFAULT_LINE: ControlLine = {
  a: { lat: 35.37165, lng: 138.92705 },
  b: { lat: 35.37185, lng: 138.92705 },
}

export function createSimulator(params: SimParams, line: ControlLine | null, startMs: number) {
  const l = line ?? DEFAULT_LINE
  const mid = midpoint(l.a, l.b)
  const proj = makeProjector(mid)
  const unproj = makeUnprojector(mid)
  const a = proj(l.a)
  const b = proj(l.b)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const nrm = { x: -dir.y, y: dir.x }

  return (nowMs: number): Fix => {
    const tSec = (nowMs - startMs) / 1000
    if (params.mode === 'pit') {
      // ラインの法線方向に ±5m を20秒周期で往復（最大約5.6km/h）
      const off = 5 * Math.sin((2 * Math.PI * tSec) / 20)
      const p = unproj({ x: nrm.x * off + dir.x * 3, y: nrm.y * off + dir.y * 3 })
      return { ...p, t: nowMs, acc: 5, speed: null }
    }
    const r = 300
    const v = params.speedKmh / 3.6
    const center = { x: dir.x * r, y: dir.y * r }
    const theta0 = Math.atan2(-dir.y, -dir.x) // 中心から見た中点の方向
    const th = theta0 + (v / r) * tSec
    const p = unproj({ x: center.x + r * Math.cos(th), y: center.y + r * Math.sin(th) })
    return { ...p, t: nowMs, acc: 5, speed: v }
  }
}
