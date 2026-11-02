import { describe, expect, it } from 'vitest'
import { makeUnprojector } from '../src/lib/geo'
import { LapDetector, detectCrossing, kmhToMps } from '../src/lib/lapDetector'
import type { ControlLine, Fix } from '../src/lib/types'

// ライン：原点を中心に南北 20m（x=0, y=-10..10）
const O = { lat: 35.37, lng: 138.93 }
const un = makeUnprojector(O)
const line: ControlLine = { a: un({ x: 0, y: -10 }), b: un({ x: 0, y: 10 }) }
const fix = (x: number, y: number, t: number, acc = 5): Fix => ({ ...un({ x, y }), t, acc, speed: null })
const opts = { extendM: 15, maxGapSec: 20, minSpeedMps: kmhToMps(15) }

describe('detectCrossing', () => {
  it('ラインを横切ると補間した時刻を返す', () => {
    // x=-10 → x=+30 を 4秒（10m/s）。交点は 1/4 の位置 → 1000ms
    const t = detectCrossing(fix(-10, 0, 0), fix(30, 0, 4000), line, opts)
    expect(t).not.toBeNull()
    expect(t as number).toBeCloseTo(1000, -1)
  })

  it('横切らなければ null', () => {
    expect(detectCrossing(fix(5, 0, 0), fix(45, 0, 4000), line, opts)).toBeNull()
  })

  it('ラインと平行な移動は null', () => {
    expect(detectCrossing(fix(0, -50, 0), fix(0, 50, 4000), line, opts)).toBeNull()
  })

  it('延長部分（端から15m以内）での交差は通過になる', () => {
    expect(detectCrossing(fix(-10, 22, 0), fix(30, 22, 4000), line, opts)).not.toBeNull()
  })

  it('延長部分より外側の交差は null', () => {
    expect(detectCrossing(fix(-10, 30, 0), fix(30, 30, 4000), line, opts)).toBeNull()
  })

  it('判定速度より遅いと null（ピットで歩いている）', () => {
    // 4m を 3秒 ≒ 4.8km/h
    expect(detectCrossing(fix(-2, 0, 0), fix(2, 0, 3000), line, opts)).toBeNull()
  })

  it('間隔が長すぎると null', () => {
    expect(detectCrossing(fix(-100, 0, 0), fix(300, 0, 21000), line, opts)).toBeNull()
  })
})

describe('LapDetector', () => {
  it('最小ラップ秒数未満の再通過は無視し、精度の悪い点は捨てる', () => {
    const d = new LapDetector(30)
    expect(d.feed(fix(-10, 0, 0), line, opts, 30)).toBeNull()
    expect(d.feed(fix(10, 0, 2000), line, opts, 30)).not.toBeNull()
    // すぐ戻ってきた（2秒後に再通過）→ 最小ラップ秒数未満なので無視
    expect(d.feed(fix(-10, 0, 4000), line, opts, 30)).toBeNull()
    expect(d.feed(fix(-10, 0, 22000), line, opts, 30)).toBeNull()
    // 精度が悪い点は捨てる（直前の点も更新しない）
    expect(d.feed(fix(10, 0, 24000, 50), line, opts, 30)).toBeNull()
    // 十分あとに通過 → 検出（直前は x=-10, t=22000 のまま）
    expect(d.feed(fix(10, 0, 40000), line, opts, 30)).toBeNull() // 18秒で20m = 4km/h → 速度不足
    expect(d.feed(fix(-10, 0, 42000), line, opts, 30)).not.toBeNull()
  })
})
