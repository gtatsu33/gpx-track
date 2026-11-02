import { describe, expect, it } from 'vitest'
import { buildLapView } from '../src/lib/laps'
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
