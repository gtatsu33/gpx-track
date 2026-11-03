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

/**
 * 後ろだけ取り直すときの開始周：手元の最後の周（1行重ねて取り、ずれを検知するため）。
 * 手元が空なら null（全部を取り直す）
 */
export function lapTailFrom(cur: LapRow[]): number | null {
  return cur.length ? cur[cur.length - 1].lap_no : null
}

/**
 * 後ろだけ取った行（from 周目以降）を、手元のラップ表（周番号の昇順）に差し替える。
 * 重ねて取った from 周目の通過が手元と違う（途中で周が削除・追加されて番号がずれた）ときは null を返す（全部を取り直す）
 */
export function mergeLapTail(cur: LapRow[], tail: LapRow[], from: number): LapRow[] | null {
  const mine = cur.find((l) => l.lap_no === from)
  const theirs = tail[0]
  if (!mine || !theirs || theirs.lap_no !== from || theirs.crossing_id !== mine.crossing_id) return null
  return [...cur.filter((l) => l.lap_no < from), ...tail]
}

/**
 * 通過の配信を受けたとき、後ろだけ取り直してよいか。
 * 最後に追加された通過（手元の最後の周より後の時刻）だけが対象。更新（削除・名前の修正）や、過去の時刻への追加は全部を取り直す
 */
export function canLoadLapTail(cur: LapRow[], ev: { op?: string; crossed_at?: string | null }): boolean {
  const last = cur[cur.length - 1]
  if (!last || ev.op !== 'insert' || !ev.crossed_at) return false
  return Date.parse(ev.crossed_at) > Date.parse(last.crossed_at)
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
