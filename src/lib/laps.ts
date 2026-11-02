// ラップ表の表示用データを作る（implement.txt ■6）
import type { LapRow } from './types'

export interface LapViewRow extends LapRow {
  isBest: boolean
  isProvisional: boolean
}

export interface LapSummary {
  total: number
  best: LapRow | null
  avgMs: number | null
}

export interface LapView {
  /** 新しい周が先頭 */
  rows: LapViewRow[]
  summary: LapSummary
}

export function buildLapView(laps: LapRow[], nowMs: number, provisionalSec: number): LapView {
  const valid = laps.filter((l) => l.lap_ms != null && l.lap_ms >= 0)
  let best: LapRow | null = null
  for (const l of valid) if (!best || (l.lap_ms as number) < (best.lap_ms as number)) best = l
  const avgMs = valid.length ? valid.reduce((s, l) => s + (l.lap_ms as number), 0) / valid.length : null

  const maxNo = laps.reduce((m, l) => Math.max(m, l.lap_no), 0)
  const rows = [...laps]
    .sort((a, b) => b.lap_no - a.lap_no)
    .map((l) => ({
      ...l,
      isBest: best != null && l.crossing_id === best.crossing_id,
      isProvisional:
        l.lap_no === maxNo &&
        !l.is_override &&
        nowMs - new Date(l.crossed_at).getTime() < provisionalSec * 1000,
    }))

  return { rows, summary: { total: laps.length, best, avgMs } }
}
