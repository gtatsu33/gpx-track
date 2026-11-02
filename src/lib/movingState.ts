// 走行状態（走行中 / ピット）と走行距離の計算（implement.txt ■5）
import { distanceM } from './geo'
import type { Fix } from './types'

export interface MovingOptions {
  maxAccuracyM: number
  maxGapSec: number
  onSec: number
  offSec: number
}

export interface DistanceSegment {
  /** ms */
  from: number
  /** ms */
  to: number
  meters: number
}

export class MovingTracker {
  moving = false
  /** 直近の速度（m/s）。分からなければ null */
  lastSpeed: number | null = null

  private prev: Fix | null = null
  private aboveSince: number | null = null
  private belowSince: number | null = null
  private pendingMeters = 0
  private segFrom: number | null = null
  private segTo: number | null = null

  constructor(private opts: MovingOptions) {}

  /** 測位を1つ処理する。精度の悪い点は捨てる（直前の点も更新しない）。戻り値は採用したかどうか */
  feed(fix: Fix, thresholdMps: number): boolean {
    if (!(fix.acc <= this.opts.maxAccuracyM)) return false
    const prev = this.prev
    const dt = prev ? (fix.t - prev.t) / 1000 : 0
    const d = prev ? distanceM(prev, fix) : 0

    // 速度：端末の値が優先、なければ直前の点からの計算値
    let speed: number | null = fix.speed != null && fix.speed >= 0 ? fix.speed : null
    if (speed == null && prev && dt > 0 && dt <= this.opts.maxGapSec) speed = d / dt
    this.lastSpeed = speed

    // ヒステリシス付きの状態切り替え
    if (speed != null) {
      if (speed >= thresholdMps) {
        this.belowSince = null
        this.aboveSince ??= fix.t
        if (!this.moving && fix.t - this.aboveSince >= this.opts.onSec * 1000) this.moving = true
      } else {
        this.aboveSince = null
        this.belowSince ??= fix.t
        if (this.moving && fix.t - this.belowSince >= this.opts.offSec * 1000) this.moving = false
      }
    }

    // 走行距離：区間の平均速度が判定速度以上の区間だけ加算
    if (prev && dt > 0 && dt <= this.opts.maxGapSec && d / dt >= thresholdMps) {
      this.pendingMeters += d
      this.segFrom ??= prev.t
      this.segTo = fix.t
    }

    this.prev = fix
    return true
  }

  /** たまった走行距離を1つのセグメントとして取り出す（0mなら null） */
  flush(): DistanceSegment | null {
    if (this.pendingMeters <= 0 || this.segFrom == null || this.segTo == null) {
      this.pendingMeters = 0
      this.segFrom = this.segTo = null
      return null
    }
    const seg = { from: this.segFrom, to: this.segTo, meters: this.pendingMeters }
    this.pendingMeters = 0
    this.segFrom = this.segTo = null
    return seg
  }
}
