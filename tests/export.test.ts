import { describe, expect, it } from 'vitest'
import { buildCsv, buildShareText, csvEscape, csvFileName, summarize, type ExportInput } from '../src/lib/export'
import type { LapRow, Room } from '../src/lib/types'

// 時刻はローカル時刻で作る（出力はローカル時刻で書くため、テストを実行する環境のタイムゾーンに依存させない）
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 3, h, m, s).toISOString()

const room: Room = {
  id: 'r1',
  code: 'ABCDEF',
  team_name: 'チームA',
  owner_id: 'u1',
  duration_min: 420,
  min_lap_sec: 30,
  moving_kmh: 15,
  line_a_lat: null,
  line_a_lng: null,
  line_b_lat: null,
  line_b_lng: null,
  status: 'finished',
  started_at: at(9, 0),
  finished_at: at(16, 0),
  last_crosser_id: null,
  owner_rider_id: 'rA',
  last_crosser_rider_id: null,
  created_at: at(8, 0),
}

const lap = (n: number, ms: number, crossed: string, rider: string, name: string, extra: Partial<LapRow> = {}): LapRow => ({
  lap_no: n,
  crossing_id: `c${n}`,
  crossed_at: crossed,
  lap_ms: ms,
  driver_id: rider,
  driver_name: name,
  driver_meters: 1000,
  source: 'gps',
  is_override: false,
  crosser_id: 'u1',
  ...extra,
})

const input: ExportInput = {
  room,
  riders: [
    { id: 'rA', name: '佐藤', user_id: 'u1' },
    { id: 'rB', name: '田中', user_id: null },
  ],
  laps: [
    lap(1, 200000, at(9, 3, 20), 'rA', '佐藤'),
    lap(2, 180000, at(9, 6, 20), 'rA', '佐藤'),
    lap(3, 190000, at(9, 9, 30), 'rB', '田中', { source: 'manual', is_override: true }),
  ],
  now: Date.parse(at(16, 5, 12)),
}

describe('export', () => {
  it('csvEscape（RFC 4180）', () => {
    expect(csvEscape('abc')).toBe('abc')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('a"b')).toBe('"a""b"')
    expect(csvEscape('a\nb')).toBe('"a\nb"')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(12)).toBe('12')
  })

  it('ライダー別の集計（周回数の多い順、オーナーの判定）', () => {
    const s = summarize(input)
    expect(s.total).toBe(3)
    expect(s.best?.lap_no).toBe(2)
    expect(s.riders.map((r) => [r.name, r.laps, r.bestMs, r.avgMs, r.totalMs, r.isOwner])).toEqual([
      ['佐藤', 2, 180000, 190000, 380000, true],
      ['田中', 1, 190000, 190000, 190000, false],
    ])
    expect(s.elapsedMs).toBe(7 * 3600 * 1000)
  })

  it('CSV：3つの表、CRLF、ベスト・手動・修正の印', () => {
    const csv = buildCsv(input)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('項目,値')
    expect(lines).toContain('チーム名,チームA')
    expect(lines).toContain('状態,終了')
    expect(lines).toContain('開始時刻,2026-11-03 09:00:00')
    expect(lines).toContain('レース時間,7:00:00')
    expect(lines).toContain('ベストラップ,3:00.0')
    expect(lines).toContain('佐藤 (オーナー),2,3:00.0,180.0,3:10.0,190.0,0:06:20')
    expect(lines).toContain('2,2026-11-03 09:06:20,3:00.0,180.0,佐藤,★,,')
    expect(lines).toContain('3,2026-11-03 09:09:30,3:10.0,190.0,田中,,○,○')
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.includes('\n') && !/[^\r]\n/.test(csv)).toBe(true)
  })

  it('ファイル名：使えない文字を _ に、開始日', () => {
    expect(csvFileName(room, input.now)).toBe('gpx-track_チームA_20261103.csv')
    expect(csvFileName({ ...room, team_name: 'A/B: C' }, input.now)).toBe('gpx-track_A_B_C_20261103.csv')
  })

  it('共有テキスト：結果（オーナー表示なし）', () => {
    expect(buildShareText(input)).toBe(
      [
        '🏁 チームA 結果',
        '2026/11/03 09:00〜16:00（7:00:00）',
        '総周回 3周',
        'ベスト 3:00.0（佐藤）',
        '平均 3:10.0',
        '―',
        '佐藤 2周（ベスト 3:00.0）',
        '田中 1周（ベスト 3:10.0）',
        '#gpx-track',
      ].join('\n'),
    )
  })

  it('共有テキスト：レース中は途中経過', () => {
    const t = buildShareText({ ...input, room: { ...room, status: 'running', finished_at: null }, now: Date.parse(at(12, 12, 45)) })
    expect(t.split('\n').slice(0, 2)).toEqual(['🏁 チームA 途中経過（3:12:45 経過）', '2026/11/03 09:00〜'])
  })
})
