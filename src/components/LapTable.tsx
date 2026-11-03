import { useState } from 'react'
import { LAP_PROVISIONAL_SEC } from '../config'
import { formatClock, formatLap } from '../lib/format'
import { buildLapView, type LapViewRow } from '../lib/laps'
import type { LapRow, Rider, Room } from '../lib/types'
import { LapRowMenu } from './LapRowMenu'

interface Props {
  visible: boolean
  laps: LapRow[]
  now: number
  isOwner: boolean
  room: Room
  riders: Rider[]
  onChanged: () => void
}

export function LapTable({ visible, laps, now, isOwner, room, riders, onChanged }: Props) {
  const [selected, setSelected] = useState<LapViewRow | null>(null)
  const view = buildLapView(laps, now, LAP_PROVISIONAL_SEC)
  const { summary } = view

  return (
    <div className="laps-wrap" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="lap-summary">
        <div>
          <small>総周回</small>
          <b>{summary.total}</b>
        </div>
        <div>
          <small>ベスト</small>
          <b>{formatLap(summary.best?.lap_ms)}</b>
          {summary.best && <small className="who">{summary.best.driver_name}</small>}
        </div>
        <div>
          <small>平均</small>
          <b>{formatLap(summary.avgMs)}</b>
        </div>
      </div>
      <div className="lap-scroll">
        <table className="lap-table">
          <thead>
            <tr>
              <th>周回</th>
              <th>通過時刻</th>
              <th>ラップ</th>
              <th>名前</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr
                key={r.crossing_id}
                className={r.isBest ? 'best' : undefined}
                onClick={isOwner ? () => setSelected(r) : undefined}
              >
                <td className="num">{r.lap_no}</td>
                <td className="num">{formatClock(r.crossed_at)}</td>
                <td className="num">
                  {formatLap(r.lap_ms)}
                  {r.isBest && ' ★'}
                </td>
                <td className={r.isProvisional ? 'provisional' : undefined}>
                  {r.driver_name}
                  {r.is_override && <span className="tag">修正</span>}
                  {r.source === 'manual' && <span className="tag">手動</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.rows.length === 0 && <p className="empty">まだ周回がありません</p>}
      </div>
      {selected && (
        <LapRowMenu
          lap={selected}
          room={room}
          riders={riders}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}
