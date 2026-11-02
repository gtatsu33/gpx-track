// コントロールラインの通過判定（implement.txt ■4）
import { distanceM, extendSegment, makeProjector, midpoint, segmentIntersection } from './geo'
import type { ControlLine, Fix } from './types'

export interface DetectOptions {
  /** ラインの延長距離（m） */
  extendM: number
  /** 2点間の最大間隔（秒） */
  maxGapSec: number
  /** 判定速度（m/s） */
  minSpeedMps: number
}

/**
 * 直前の測位 p と今回の測位 q の間でラインを越えたかを判定する。
 * 越えていれば補間した通過時刻（ms）、そうでなければ null。
 */
export function detectCrossing(p: Fix, q: Fix, line: ControlLine, opts: DetectOptions): number | null {
  const dt = (q.t - p.t) / 1000
  if (dt <= 0 || dt > opts.maxGapSec) return null

  const speed = distanceM(p, q) / dt
  if (speed < opts.minSpeedMps) return null

  const proj = makeProjector(midpoint(line.a, line.b))
  const [a2, b2] = extendSegment(proj(line.a), proj(line.b), opts.extendM)
  const hit = segmentIntersection(proj(p), proj(q), a2, b2)
  if (!hit) return null
  return p.t + hit.t * (q.t - p.t)
}

/**
 * 測位を順に受け取って通過を検出する状態付きの判定器。
 * 精度の悪い点は捨て、同じ端末で最小ラップ秒数未満の再通過は無視する。
 */
export class LapDetector {
  private prev: Fix | null = null
  private lastCrossingT: number | null = null

  constructor(private maxAccuracyM: number) {}

  /** 戻り値：通過時刻（ms）または null */
  feed(fix: Fix, line: ControlLine | null, opts: DetectOptions, minLapSec: number): number | null {
    if (!(fix.acc <= this.maxAccuracyM)) return null
    const prev = this.prev
    this.prev = fix
    if (!prev || !line) return null
    const t = detectCrossing(prev, fix, line, opts)
    if (t == null) return null
    if (this.lastCrossingT != null && t - this.lastCrossingT < minLapSec * 1000) return null
    this.lastCrossingT = t
    return t
  }

  reset(): void {
    this.prev = null
    this.lastCrossingT = null
  }
}

export const kmhToMps = (kmh: number) => kmh / 3.6
