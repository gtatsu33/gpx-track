// 個人戦の順位表（純粋関数。spec.txt 3.6）
import { formatLap } from './format'
import type { LapRow, Rider } from './types'

/** トップとの差 */
export type Gap = { kind: 'leader' } | { kind: 'laps'; laps: number } | { kind: 'time'; ms: number }

export interface StandingRow {
  /** riders.id（不明なら null） */
  riderId: string | null
  name: string
  isOwner: boolean
  /** 順位（周回が0の人は null） */
  position: number | null
  laps: number
  /** 今の周回数に到達した時刻（最後の通過。ms） */
  reachedAtMs: number | null
  bestMs: number | null
  avgMs: number | null
  lastLapMs: number | null
  totalMs: number
  gap: Gap | null
  /** 本人の周（本人の周番号の昇順） */
  rows: LapRow[]
}

export interface StandingsOptions {
  riders: Rider[]
  ownerRiderId: string | null
  /** 周回が0でも表に載せるライダー（走る端末で今のライダーになっている人） */
  activeRiderIds?: (string | null)[]
}

const keyOf = (l: LapRow) => l.driver_id ?? `name:${l.driver_name}`
const validMs = (l: LapRow) => (l.lap_ms != null && l.lap_ms >= 0 ? l.lap_ms : null)

/**
 * 順位：周回数の多い順。同じ周回数なら、その周回数に先に到達した順。
 * 周回が0の人は下にまとめ、名前の順に並べる
 */
export function computeStandings(laps: LapRow[], opts: StandingsOptions): StandingRow[] {
  const nameById = new Map(opts.riders.map((r) => [r.id, r.name]))
  const byKey = new Map<string, StandingRow>()
  const newRow = (riderId: string | null, name: string): StandingRow => ({
    riderId,
    name,
    isOwner: riderId != null && riderId === opts.ownerRiderId,
    position: null,
    laps: 0,
    reachedAtMs: null,
    bestMs: null,
    avgMs: null,
    lastLapMs: null,
    totalMs: 0,
    gap: null,
    rows: [],
  })

  const sorted = [...laps].sort((a, b) => Date.parse(a.crossed_at) - Date.parse(b.crossed_at))
  for (const l of sorted) {
    const k = keyOf(l)
    let s = byKey.get(k)
    if (!s) {
      s = newRow(l.driver_id, (l.driver_id && nameById.get(l.driver_id)) || l.driver_name)
      byKey.set(k, s)
    }
    s.rows.push(l)
  }
  for (const id of opts.activeRiderIds ?? []) {
    if (id && !byKey.has(id)) byKey.set(id, newRow(id, nameById.get(id) ?? '?'))
  }

  for (const s of byKey.values()) {
    s.laps = s.rows.length
    const last = s.rows[s.rows.length - 1]
    s.reachedAtMs = last ? Date.parse(last.crossed_at) : null
    s.lastLapMs = last ? validMs(last) : null
    let n = 0
    for (const l of s.rows) {
      const ms = validMs(l)
      if (ms == null) continue
      n += 1
      s.totalMs += ms
      if (s.bestMs == null || ms < s.bestMs) s.bestMs = ms
    }
    s.avgMs = n > 0 ? s.totalMs / n : null
  }

  const racing = [...byKey.values()]
    .filter((s) => s.laps > 0)
    .sort((a, b) => b.laps - a.laps || (a.reachedAtMs ?? 0) - (b.reachedAtMs ?? 0))
  const idle = [...byKey.values()].filter((s) => s.laps === 0).sort((a, b) => a.name.localeCompare(b.name, 'ja'))

  const leader = racing[0]
  racing.forEach((s, i) => {
    s.position = i + 1
    if (s === leader) s.gap = { kind: 'leader' }
    else if (s.laps < leader.laps) s.gap = { kind: 'laps', laps: leader.laps - s.laps }
    else s.gap = { kind: 'time', ms: (s.reachedAtMs ?? 0) - (leader.reachedAtMs ?? 0) }
  })
  return [...racing, ...idle]
}

/** トップとの差の表示：「トップ」「+1周」「+0:12.3」 */
export function formatGap(gap: Gap | null): string {
  if (!gap) return '—'
  if (gap.kind === 'leader') return 'トップ'
  if (gap.kind === 'laps') return `+${gap.laps}周`
  return `+${formatLap(gap.ms)}`
}

/** ライダーごとの周回数（マップのラベル用） */
export function lapCountByRider(laps: LapRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of laps) if (l.driver_id) m.set(l.driver_id, (m.get(l.driver_id) ?? 0) + 1)
  return m
}
