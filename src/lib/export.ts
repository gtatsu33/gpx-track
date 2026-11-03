// レース結果の出力：CSV と共有テキストを作る（純粋関数。spec.txt 3.10）
import { formatDuration, formatLap, toDatetimeLocal } from './format'
import { buildLapView } from './laps'
import type { LapRow, Rider, Room } from './types'

export interface ExportInput {
  room: Room
  laps: LapRow[]
  riders: Rider[]
  /** 出力した時刻（ms, epoch） */
  now: number
}

export interface RiderStat {
  /** riders.id（不明なら null） */
  riderId: string | null
  name: string
  isOwner: boolean
  laps: number
  bestMs: number | null
  avgMs: number | null
  totalMs: number
}

export interface ResultSummary {
  /** レース中なら true（途中経過） */
  running: boolean
  startMs: number | null
  /** 終了時刻（レース中は null） */
  endMs: number | null
  /** レース時間（レース中は今までの経過時間） */
  elapsedMs: number | null
  total: number
  best: LapRow | null
  avgMs: number | null
  riders: RiderStat[]
}

const validMs = (l: LapRow) => (l.lap_ms != null && l.lap_ms >= 0 ? l.lap_ms : null)

/** 概要とライダー別の集計 */
export function summarize({ room, laps, riders, now }: ExportInput): ResultSummary {
  const { summary } = buildLapView(laps, now, 0)
  const running = room.status === 'running'
  const startMs = room.started_at ? Date.parse(room.started_at) : null
  const endMs = !running && room.finished_at ? Date.parse(room.finished_at) : null
  const elapsedMs = startMs == null ? null : (endMs ?? now) - startMs

  const nameById = new Map(riders.map((r) => [r.id, r.name]))
  const byRider = new Map<string, RiderStat>()
  const validCount = new Map<RiderStat, number>()
  for (const l of laps) {
    const key = l.driver_id ?? `name:${l.driver_name}`
    let s = byRider.get(key)
    if (!s) {
      s = {
        riderId: l.driver_id,
        name: (l.driver_id && nameById.get(l.driver_id)) || l.driver_name,
        isOwner: l.driver_id != null && l.driver_id === room.owner_rider_id,
        laps: 0,
        bestMs: null,
        avgMs: null,
        totalMs: 0,
      }
      byRider.set(key, s)
    }
    s.laps += 1
    const ms = validMs(l)
    if (ms != null) {
      s.totalMs += ms
      if (s.bestMs == null || ms < s.bestMs) s.bestMs = ms
      validCount.set(s, (validCount.get(s) ?? 0) + 1)
    }
  }
  for (const [s, n] of validCount) s.avgMs = s.totalMs / n
  const riderStats = [...byRider.values()].sort(
    (a, b) => b.laps - a.laps || (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity) || a.name.localeCompare(b.name, 'ja'),
  )

  return {
    running,
    startMs,
    endMs,
    elapsedMs,
    total: summary.total,
    best: summary.best,
    avgMs: summary.avgMs,
    riders: riderStats,
  }
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

/** RFC 4180：カンマ・ダブルクォート・改行を含む値はダブルクォートで囲む */
export function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const csvLine = (cells: (string | number | null | undefined)[]) => cells.map(csvEscape).join(',')

/** ローカル時刻の YYYY-MM-DD HH:MM:SS */
const localDateTime = (ms: number | string) => toDatetimeLocal(ms).replace('T', ' ')
const sec = (ms: number | null) => (ms == null ? '' : (Math.round(ms / 100) / 10).toFixed(1))
const lapText = (ms: number | null) => (ms == null ? '' : formatLap(ms))

/** CSV 本文（BOM なし。改行は CRLF）。表1 概要 / 表2 ライダー別 / 表3 ラップ表 */
export function buildCsv(input: ExportInput): string {
  const { room, laps } = input
  const s = summarize(input)
  const lines: string[] = []

  // 表1：概要
  lines.push(csvLine(['項目', '値']))
  lines.push(csvLine(['チーム名', room.team_name]))
  lines.push(csvLine(['状態', s.running ? 'レース中（途中経過）' : room.status === 'finished' ? '終了' : 'スタート前']))
  lines.push(csvLine(['開始時刻', s.startMs != null ? localDateTime(s.startMs) : '']))
  lines.push(csvLine(['終了時刻', s.endMs != null ? localDateTime(s.endMs) : '']))
  lines.push(csvLine(['レース時間', s.elapsedMs != null ? formatDuration(s.elapsedMs) : '']))
  lines.push(csvLine(['総周回', s.total]))
  lines.push(csvLine(['ベストラップ', lapText(s.best?.lap_ms ?? null)]))
  lines.push(csvLine(['ベストラップのライダー', s.best?.driver_name ?? '']))
  lines.push(csvLine(['平均ラップ', lapText(s.avgMs)]))
  lines.push(csvLine(['出力日時', localDateTime(input.now)]))
  lines.push('')

  // 表2：ライダー別（周回数の多い順）
  lines.push(csvLine(['ライダー', '周回数', 'ベストラップ', 'ベストラップ(秒)', '平均ラップ', '平均ラップ(秒)', '合計走行時間']))
  for (const r of s.riders) {
    lines.push(
      csvLine([
        r.isOwner ? `${r.name} (オーナー)` : r.name,
        r.laps,
        lapText(r.bestMs),
        sec(r.bestMs),
        lapText(r.avgMs),
        sec(r.avgMs),
        formatDuration(r.totalMs),
      ]),
    )
  }
  lines.push('')

  // 表3：ラップ表（1周目から）
  lines.push(csvLine(['周回', '通過時刻', 'ラップタイム', 'ラップタイム(秒)', 'ライダー', 'ベスト', '手動', '修正']))
  for (const l of [...laps].sort((a, b) => a.lap_no - b.lap_no)) {
    const ms = validMs(l)
    lines.push(
      csvLine([
        l.lap_no,
        localDateTime(l.crossed_at),
        lapText(ms),
        sec(ms),
        l.driver_name,
        s.best && l.crossing_id === s.best.crossing_id ? '★' : '',
        l.source === 'manual' ? '○' : '',
        l.is_override ? '○' : '',
      ]),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** gpx-track_<チーム名>_<開始日 YYYYMMDD>.csv（ファイル名に使えない文字は _ にする） */
export function csvFileName(room: Room, now: number): string {
  const team = room.team_name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'team'
  const date = toDatetimeLocal(room.started_at ?? now).slice(0, 10).replace(/-/g, '')
  return `gpx-track_${team}_${date}.csv`
}

// ---------------------------------------------------------------------
// 共有テキスト
// ---------------------------------------------------------------------

const ymd = (ms: number) => toDatetimeLocal(ms).slice(0, 10).replace(/-/g, '/')
const hm = (ms: number) => toDatetimeLocal(ms).slice(11, 16)

/** LINE や SNS に貼る結果の文章（チーム外に出すので「(オーナー)」は付けない） */
export function buildShareText(input: ExportInput): string {
  const { room } = input
  const s = summarize(input)
  const lines: string[] = []

  lines.push(
    s.running
      ? `🏁 ${room.team_name} 途中経過（${formatDuration(s.elapsedMs ?? 0)} 経過）`
      : `🏁 ${room.team_name} 結果`,
  )
  if (s.startMs != null) {
    if (s.endMs != null) {
      const sameDay = ymd(s.startMs) === ymd(s.endMs)
      const end = sameDay ? hm(s.endMs) : `${ymd(s.endMs)} ${hm(s.endMs)}`
      lines.push(`${ymd(s.startMs)} ${hm(s.startMs)}〜${end}（${formatDuration(s.elapsedMs ?? 0)}）`)
    } else {
      lines.push(`${ymd(s.startMs)} ${hm(s.startMs)}〜`)
    }
  }
  lines.push(`総周回 ${s.total}周`)
  if (s.best) lines.push(`ベスト ${formatLap(s.best.lap_ms)}（${s.best.driver_name}）`)
  if (s.avgMs != null) lines.push(`平均 ${formatLap(s.avgMs)}`)
  if (s.riders.length > 0) {
    lines.push('―')
    for (const r of s.riders) {
      lines.push(r.bestMs != null ? `${r.name} ${r.laps}周（ベスト ${formatLap(r.bestMs)}）` : `${r.name} ${r.laps}周`)
    }
  }
  lines.push('#gpx-track')
  return lines.join('\n')
}
