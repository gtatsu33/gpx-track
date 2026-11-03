import { useState } from 'react'
import { formatClock, formatLap } from '../lib/format'
import type { LapViewRow } from '../lib/laps'
import { computeStandings, formatGap, type StandingRow } from '../lib/standings'
import type { LapRow, Member, Rider, Room } from '../lib/types'
import { LapRowMenu } from './LapRowMenu'
import { Modal } from './Modal'

interface Props {
  visible: boolean
  laps: LapRow[]
  room: Room
  riders: Rider[]
  members: Member[]
  myRiderId: string | null
  isOwner: boolean
  onChanged: () => void
}

/** 個人戦の「順位」タブ。名前をタップすると、その人のラップ一覧を開く */
export function StandingsTable({ visible, laps, room, riders, members, myRiderId, isOwner, onChanged }: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [menuLap, setMenuLap] = useState<LapViewRow | null>(null)

  // 周回が0でも、走る端末で今のライダーになっている人は表に載せる
  const active = members.filter((m) => !m.spectator).map((m) => m.rider_id)
  const rows = computeStandings(laps, { riders, ownerRiderId: room.owner_rider_id, activeRiderIds: active })
  const keyOf = (s: StandingRow) => s.riderId ?? `name:${s.name}`
  const opened = openKey ? rows.find((s) => keyOf(s) === openKey) ?? null : null

  return (
    <div className="laps-wrap" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="lap-scroll">
        <table className="lap-table standings">
          <thead>
            <tr>
              <th>順位</th>
              <th>名前</th>
              <th>周回</th>
              <th>差</th>
              <th>ベスト</th>
              <th>最後</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={keyOf(s)}
                className={s.riderId != null && s.riderId === myRiderId ? 'me' : undefined}
                onClick={() => setOpenKey(keyOf(s))}
              >
                <td className="pos">{s.position ?? '—'}</td>
                <td>{s.name}</td>
                <td className="num">{s.laps}</td>
                <td className="num">{s.laps > 0 ? formatGap(s.gap) : ''}</td>
                <td className="num">{formatLap(s.bestMs)}</td>
                <td className="num">{formatLap(s.lastLapMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">まだ参加者がいません</p>}
      </div>

      {opened && !menuLap && (
        <Modal title={`${opened.name}　${opened.laps}周`} onClose={() => setOpenKey(null)}>
          <table className="lap-table">
            <thead>
              <tr>
                <th>周回</th>
                <th>通過時刻</th>
                <th>ラップ</th>
              </tr>
            </thead>
            <tbody>
              {[...opened.rows].reverse().map((l) => {
                const isBest = l.lap_ms != null && l.lap_ms === opened.bestMs
                return (
                  <tr
                    key={l.crossing_id}
                    className={isBest ? 'best' : undefined}
                    onClick={isOwner ? () => setMenuLap({ ...l, isBest, isProvisional: false }) : undefined}
                  >
                    <td className="num">{l.rider_lap_no ?? '—'}</td>
                    <td className="num">{formatClock(l.crossed_at)}</td>
                    <td className="num">
                      {formatLap(l.lap_ms)}
                      {isBest && ' ★'}
                      {l.is_override && <span className="tag">修正</span>}
                      {l.source === 'manual' && <span className="tag">手動</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {opened.rows.length === 0 && <p className="empty">まだ周回がありません</p>}
          {isOwner && opened.rows.length > 0 && <p className="hint">行をタップすると、削除や付け替えができます。</p>}
        </Modal>
      )}

      {menuLap && (
        <LapRowMenu
          lap={menuLap}
          room={room}
          riders={riders}
          onClose={() => setMenuLap(null)}
          onDone={() => {
            setMenuLap(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
