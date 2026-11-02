import { useEffect, useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import type { RoomStatus } from '../lib/types'
import { APP_VERSION } from '../version'
import { useNotify } from './Notify'

interface RoomItem {
  id: string
  code: string
  team_name: string
  status: RoomStatus
  created_at: string
}

interface Props {
  userName: string
  initialCode: string
  onEnter: (roomId: string) => void
  onCreate: () => void
  onReclaim: () => void
}

const STATUS_LABEL: Record<RoomStatus, string> = { ready: 'スタート前', running: 'レース中', finished: '終了' }

export function Home({ userName, initialCode, onEnter, onCreate, onReclaim }: Props) {
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [rooms, setRooms] = useState<RoomItem[]>([])
  const notify = useNotify()

  useEffect(() => {
    void supabase
      .from('rooms')
      .select('id, code, team_name, status, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRooms((data as RoomItem[]) ?? []))
  }, [])

  const join = async () => {
    const c = code.trim().toUpperCase()
    if (c.length !== 6) {
      notify('参加コードは6文字です', 'error')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('join_room', { p_code: c })
    setBusy(false)
    if (error) notify(errorText(error), 'error')
    else onEnter(data as string)
  }

  return (
    <div className="page">
      <h1 className="brand">🏁 gpx-track</h1>
      <p className="lead">ようこそ、{userName} さん</p>

      <section className="card">
        <h2>参加コードで参加</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void join()
          }}
        >
          <input
            className="code-input"
            value={code}
            maxLength={6}
            placeholder="ABC234"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn primary" disabled={busy}>
            参加
          </button>
        </form>
      </section>

      {rooms.length > 0 && (
        <section className="card">
          <h2>参加中のルーム</h2>
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id}>
                <button className="room-item" onClick={() => onEnter(r.id)}>
                  <span className="room-name">{r.team_name}</span>
                  <span className="room-meta">
                    {r.code}・{STATUS_LABEL[r.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>オーナー</h2>
        <button className="btn block" onClick={onCreate}>
          ルームを作成
        </button>
        <button className="btn block subtle" onClick={onReclaim}>
          オーナー権限の復帰
        </button>
      </section>

      <footer className="version">v{APP_VERSION}</footer>
    </div>
  )
}
