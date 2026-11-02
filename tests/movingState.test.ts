import { describe, expect, it } from 'vitest'
import { makeUnprojector } from '../src/lib/geo'
import { MovingTracker } from '../src/lib/movingState'
import type { Fix } from '../src/lib/types'

const O = { lat: 35.37, lng: 138.93 }
const un = makeUnprojector(O)
const opts = { maxAccuracyM: 30, maxGapSec: 20, onSec: 10, offSec: 30 }
const TH = 15 / 3.6 // 15km/h

/** x 方向に speed(m/s) で n 秒走る測位列（1秒ごと） */
function run(startX: number, startT: number, speed: number, n: number, acc = 5): Fix[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    ...un({ x: startX + speed * i, y: 0 }),
    t: startT + i * 1000,
    acc,
    speed: null,
  }))
}

describe('MovingTracker', () => {
  it('判定速度以上が10秒続くと走行中、未満が30秒続くとピット', () => {
    const m = new MovingTracker(opts)
    const fast = run(0, 0, 10, 15)
    fast.slice(0, 10).forEach((f) => m.feed(f, TH))
    expect(m.moving).toBe(false) // 速度が出るのは2点目（t=1s）から、9秒経過
    fast.slice(10).forEach((f) => m.feed(f, TH))
    expect(m.moving).toBe(true)

    const slow = run(150, 16000, 1, 40)
    slow.slice(0, 25).forEach((f) => m.feed(f, TH))
    expect(m.moving).toBe(true) // 一時的な減速では切り替わらない
    slow.slice(25).forEach((f) => m.feed(f, TH))
    expect(m.moving).toBe(false)
  })

  it('端末の速度値があればそれを使う', () => {
    const m = new MovingTracker(opts)
    m.feed({ ...un({ x: 0, y: 0 }), t: 0, acc: 5, speed: 8 }, TH)
    expect(m.lastSpeed).toBe(8)
  })

  it('精度の悪い点は捨てる', () => {
    const m = new MovingTracker(opts)
    expect(m.feed({ ...un({ x: 0, y: 0 }), t: 0, acc: 50, speed: null }, TH)).toBe(false)
  })

  it('判定速度以上の区間だけ距離を加算し、flush でセグメントにまとめる', () => {
    const m = new MovingTracker(opts)
    run(0, 0, 10, 10).forEach((f) => m.feed(f, TH)) // 100m
    run(100, 11000, 1, 5).forEach((f) => m.feed(f, TH)) // 歩き（加算しない）
    const seg = m.flush()
    expect(seg).not.toBeNull()
    expect(seg!.meters).toBeGreaterThan(99.5) // 走った100mだけ。歩いた分は入らない
    expect(seg!.meters).toBeLessThan(100.5)
    expect(seg!.to).toBe(10000)
    expect(seg!.from).toBe(0)
    expect(m.flush()).toBeNull()
  })

  it('間隔が長すぎる区間は加算しない', () => {
    const m = new MovingTracker(opts)
    m.feed({ ...un({ x: 0, y: 0 }), t: 0, acc: 5, speed: null }, TH)
    m.feed({ ...un({ x: 500, y: 0 }), t: 25000, acc: 5, speed: null }, TH)
    expect(m.flush()).toBeNull()
  })
})
