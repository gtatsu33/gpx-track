import { formatDuration } from '../lib/format'
import type { Room } from '../lib/types'
import type { GeoStatus } from '../hooks/useGeolocation'
import type { WakeLockStatus } from '../hooks/useWakeLock'

interface Props {
  room: Room
  now: number
  lapCount: number
  riderName: string | null
  riderIsMe: boolean
  meMoving: boolean
  /** この端末の今のライダー */
  myRiderName: string
  isOwner: boolean
  /** 走らない端末（観戦・運営） */
  spectator: boolean
  /** 個人戦の表示（例：「自分：3位　12周　+0:12.3」「トップ：佐藤 12周」） */
  soloText: string
  onRiderPick: () => void
  wake: WakeLockStatus
  geo: GeoStatus
  connected: boolean
  onWakeInfo: () => void
  onGeoInfo: () => void
  onSettings: () => void
}

function raceClock(room: Room, now: number): string {
  if (room.status === 'ready' || !room.started_at) return 'スタート前'
  if (room.status === 'finished') return 'レース終了'
  const elapsed = now - Date.parse(room.started_at)
  let s = `経過 ${formatDuration(elapsed)}`
  if (room.duration_min) s += ` / 残 ${formatDuration(room.duration_min * 60000 - elapsed)}`
  return s
}

export function Header(p: Props) {
  const geoBad = p.geo === 'denied' || p.geo === 'unavailable' || p.geo === 'unsupported'
  return (
    <header className="room-header">
      <div className="hdr-row">
        <span className="team">{p.room.team_name}</span>
        <span className="clock">{raceClock(p.room, p.now)}</span>
      </div>
      <div className="hdr-row">
        {p.room.mode === 'team' && (
          <span className="laps">
            <b>{p.lapCount}</b>周
          </span>
        )}
        <button className="rider" onClick={p.onRiderPick} aria-label="この端末のライダーを切り替え">
          {p.room.mode === 'solo' ? (
            <span className="rider-now">
              {p.soloText}
              {p.meMoving && <span className="badge">走行中</span>}
            </span>
          ) : (
            <span className="rider-now">
              🚴 {p.riderName ?? '—'}
              {p.meMoving && <span className="badge">{p.riderIsMe ? '走行中' : '自分:走行中'}</span>}
            </span>
          )}
          <span className="rider-me">
            この端末：{p.myRiderName}
            {p.isOwner && <span className="owner-tag">オーナー</span>}
            {p.spectator && <span className="spec-tag">観戦中</span>}
          </span>
        </button>
        <span className="hdr-icons">
          <span className={`conn ${p.connected ? 'on' : 'off'}`} title={p.connected ? '接続中' : '再接続中'} />
          {geoBad && (
            <button className="icon-btn warn" onClick={p.onGeoInfo} aria-label="位置情報の状態">
              📍⚠
            </button>
          )}
          {p.geo === 'simulated' && <span className="sim">SIM</span>}
          <button className="icon-btn" onClick={p.onWakeInfo} aria-label="画面点灯の状態">
            {p.wake === 'active' ? '☀' : '⚠'}
          </button>
          <button className="icon-btn" onClick={p.onSettings} aria-label="設定">
            ⚙
          </button>
        </span>
      </div>
    </header>
  )
}
