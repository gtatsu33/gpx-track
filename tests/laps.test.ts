import { describe, expect, it } from 'vitest'
import { buildLapView, canLoadLapTail, lapTailFrom, mergeLapTail } from '../src/lib/laps'
import type { LapRow } from '../src/lib/types'

const row = (n: number, ms: number, at: string, over = false): LapRow => ({
  lap_no: n,
  crossing_id: `c${n}`,
  crossed_at: at,
  lap_ms: ms,
  driver_id: 'u1',
  driver_name: 'A',
  driver_meters: 1000,
  source: 'gps',
  is_override: over,
  crosser_id: 'u1',
})

describe('buildLapView', () => {
  const laps = [
    row(1, 150000, '2026-11-02T01:02:30Z'),
    row(2, 140000, '2026-11-02T01:04:50Z'),
    row(3, 160000, '2026-11-02T01:07:30Z'),
  ]

  it('新しい周が先頭、ベスト・平均・総周回', () => {
    const v = buildLapView(laps, Date.parse('2026-11-02T02:00:00Z'), 15)
    expect(v.rows.map((r) => r.lap_no)).toEqual([3, 2, 1])
    expect(v.rows.find((r) => r.isBest)?.lap_no).toBe(2)
    expect(v.summary.total).toBe(3)
    expect(v.summary.best?.lap_no).toBe(2)
    expect(v.summary.avgMs).toBe(150000)
  })

  it('通過直後の最新周は暫定', () => {
    const v = buildLapView(laps, Date.parse('2026-11-02T01:07:40Z'), 15)
    expect(v.rows[0].isProvisional).toBe(true)
    expect(v.rows[1].isProvisional).toBe(false)
  })

  it('オーナーが修正した周は暫定にしない', () => {
    const l = [...laps.slice(0, 2), row(3, 160000, '2026-11-02T01:07:30Z', true)]
    const v = buildLapView(l, Date.parse('2026-11-02T01:07:40Z'), 15)
    expect(v.rows[0].isProvisional).toBe(false)
  })

  it('空', () => {
    const v = buildLapView([], 0, 15)
    expect(v.rows).toEqual([])
    expect(v.summary).toEqual({ total: 0, best: null, avgMs: null })
  })
})

describe('ラップ表の後ろだけの取り直し', () => {
  const cur = [
    row(1, 150000, '2026-11-02T01:02:30Z'),
    row(2, 140000, '2026-11-02T01:04:50Z'),
    row(3, 160000, '2026-11-02T01:07:30Z'),
  ]

  it('開始周は手元の最後の周（空なら null）', () => {
    expect(lapTailFrom(cur)).toBe(3)
    expect(lapTailFrom([])).toBeNull()
  })

  it('重ねた周が一致すれば差し替える', () => {
    const tail = [row(3, 160000, '2026-11-02T01:07:30Z', true), row(4, 150000, '2026-11-02T01:10:00Z')]
    const merged = mergeLapTail(cur, tail, 3)
    expect(merged?.map((l) => l.lap_no)).toEqual([1, 2, 3, 4])
    expect(merged?.[2].is_override).toBe(true) // 重ねた周も新しい値になる
  })

  it('途中で周が削除されて番号がずれていたら null（全部を取り直す）', () => {
    // 2周目が削除され、3周目だった通過が2周目になった → 3周目は c4 になっている
    const tail = [{ ...row(3, 150000, '2026-11-02T01:10:00Z'), crossing_id: 'c4' }]
    expect(mergeLapTail(cur, tail, 3)).toBeNull()
    expect(mergeLapTail(cur, [], 3)).toBeNull()
  })

  it('後ろだけでよいのは、最後より後の時刻の追加だけ', () => {
    expect(canLoadLapTail(cur, { op: 'insert', crossed_at: '2026-11-02T01:10:00Z' })).toBe(true)
    expect(canLoadLapTail(cur, { op: 'insert', crossed_at: '2026-11-02T01:05:00Z' })).toBe(false) // 過去の時刻への手動追加
    expect(canLoadLapTail(cur, { op: 'update', crossed_at: '2026-11-02T01:10:00Z' })).toBe(false) // 削除・名前の修正
    expect(canLoadLapTail(cur, { id: null } as { op?: string })).toBe(false) // 開始時刻の修正
    expect(canLoadLapTail([], { op: 'insert', crossed_at: '2026-11-02T01:10:00Z' })).toBe(false)
  })
})
