import { describe, expect, it } from 'vitest'
import { buildCsv, buildShareText, type ExportInput } from '../src/lib/export'
import { shouldSendPos } from '../src/lib/posPolicy'
import { computeStandings, formatGap, lapCountByRider } from '../src/lib/standings'
import type { LapRow, Room } from '../src/lib/types'

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 3, h, m, s).toISOString()

const room: Room = {
  id: 'r1',
  code: 'ABCDEF',
  team_name: '大会',
  owner_id: 'u1',
  duration_min: 60,
  min_lap_sec: 30,
  moving_kmh: 15,
  line_a_lat: null,
  line_a_lng: null,
  line_b_lat: null,
  line_b_lng: null,
  status: 'finished',
  mode: 'solo',
  started_at: at(9, 0),
  finished_at: at(10, 0),
  last_crosser_id: null,
  owner_rider_id: 'rO',
  last_crosser_rider_id: null,
  created_at: at(8, 0),
}

let seq = 0
const lap = (rider: string, name: string, n: number, crossed: string, ms: number): LapRow => ({
  lap_no: ++seq,
  crossing_id: `c${seq}`,
  crossed_at: crossed,
  lap_ms: ms,
  driver_id: rider,
  driver_name: name,
  driver_meters: null,
  source: 'gps',
  is_override: false,
  crosser_id: null,
  rider_lap_no: n,
})

// A：3周（最後 9:15:00）、B：3周（最後 9:15:12.3）、C：2周
const laps: LapRow[] = [
  lap('rA', 'A', 1, at(9, 5), 300000),
  lap('rB', 'B', 1, at(9, 5, 5), 305000),
  lap('rC', 'C', 1, at(9, 6), 360000),
  lap('rA', 'A', 2, at(9, 10), 300000),
  lap('rB', 'B', 2, at(9, 10, 6), 301000),
  lap('rA', 'A', 3, at(9, 15), 300000),
  lap('rC', 'C', 2, at(9, 12), 360000),
  { ...lap('rB', 'B', 3, at(9, 15, 12), 306300), crossed_at: new Date(Date.parse(at(9, 15, 12)) + 300).toISOString() },
]
const riders = [
  { id: 'rA', name: 'A', user_id: null },
  { id: 'rB', name: 'B', user_id: null },
  { id: 'rC', name: 'C', user_id: null },
  { id: 'rD', name: 'D', user_id: null },
  { id: 'rO', name: 'オーナー', user_id: 'u1' },
]

describe('個人戦の順位', () => {
  it('周回数の多い順、同じ周回数は先に到達した順。0周の人は下', () => {
    const s = computeStandings(laps, { riders, ownerRiderId: 'rO', activeRiderIds: ['rD', 'rA', null] })
    expect(s.map((r) => [r.name, r.position, r.laps])).toEqual([
      ['A', 1, 3],
      ['B', 2, 3],
      ['C', 3, 2],
      ['D', null, 0],
    ])
    expect(formatGap(s[0].gap)).toBe('トップ')
    expect(formatGap(s[1].gap)).toBe('+0:12.3')
    expect(formatGap(s[2].gap)).toBe('+1周')
    expect(s[0].bestMs).toBe(300000)
    expect(s[1].lastLapMs).toBe(306300)
  })

  it('マップ用の周回数', () => {
    const c = lapCountByRider(laps)
    expect([c.get('rA'), c.get('rB'), c.get('rC'), c.get('rD')]).toEqual([3, 3, 2, undefined])
  })
})

describe('個人戦の出力', () => {
  const input: ExportInput = { room, laps, riders, now: Date.parse(at(10, 5)) }

  it('CSV：順位表と、本人の周番号付きのラップ表', () => {
    const lines = buildCsv(input).split('\r\n')
    expect(lines).toContain('モード,個人戦')
    expect(lines).toContain('参加人数,3')
    expect(lines).toContain('トップ,A')
    expect(lines).toContain('順位,ライダー,周回,トップとの差,ベスト,ベスト(秒),平均,平均(秒),最終通過時刻')
    expect(lines).toContain('1,A,3,トップ,5:00.0,300.0,5:00.0,300.0,2026-11-03 09:15:00')
    expect(lines).toContain('3,C,2,+1周,6:00.0,360.0,6:00.0,360.0,2026-11-03 09:12:00')
    expect(lines).toContain('通し番号,ライダー,本人の周,通過時刻,ラップタイム,ラップタイム(秒),本人のベスト,手動,修正')
    expect(lines.some((l) => l.startsWith('2,B,1,2026-11-03 09:05:05,5:05.0,305.0,,,'))).toBe(true)
  })

  it('共有テキスト：順位の一覧', () => {
    const t = buildShareText(input).split('\n')
    expect(t[0]).toBe('🏁 大会 結果')
    expect(t).toContain('1位 A 3周（ベスト 5:00.0）')
    expect(t).toContain('3位 C 2周（ベスト 6:00.0）')
    expect(t.some((l) => l.startsWith('総周回'))).toBe(false)
    expect(t[t.length - 1]).toBe('#gpx-track')
  })
})

describe('位置を送るかどうか', () => {
  const none = { lastSentAt: null, lastSentMoving: null }
  it('まだ送っていなければ送る（ピットでも）', () => {
    expect(shouldSendPos(none, false, 1000, 5000)).toBe(true)
  })
  it('走行中は間隔ごと', () => {
    expect(shouldSendPos({ lastSentAt: 0, lastSentMoving: true }, true, 4999, 5000)).toBe(false)
    expect(shouldSendPos({ lastSentAt: 0, lastSentMoving: true }, true, 5000, 5000)).toBe(true)
    expect(shouldSendPos({ lastSentAt: 0, lastSentMoving: true }, true, 9999, 10000)).toBe(false)
  })
  it('ピットになったときに1回だけ送り、その後は送らない', () => {
    expect(shouldSendPos({ lastSentAt: 0, lastSentMoving: true }, false, 1000, 5000)).toBe(true)
    expect(shouldSendPos({ lastSentAt: 1000, lastSentMoving: false }, false, 999999, 5000)).toBe(false)
  })
  it('ピットから走行中になったらすぐ送る', () => {
    expect(shouldSendPos({ lastSentAt: 1000, lastSentMoving: false }, true, 7000, 5000)).toBe(true)
  })
})
