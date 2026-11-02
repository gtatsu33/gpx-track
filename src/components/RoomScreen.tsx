import { useCallback, useEffect, useState } from 'react'
import { STALE_MARKER_SEC } from '../config'
import { errorText, supabase } from '../lib/supabase'
import { roomLine, type ControlLine } from '../lib/types'
import { useRoom } from '../hooks/useRoom'
import { useTracker } from '../hooks/useTracker'
import { useWakeLock } from '../hooks/useWakeLock'
import { ChatArea, QuickButtons } from './ChatArea'
import { Header } from './Header'
import { LapTable } from './LapTable'
import { MapView } from './MapView'
import { Modal } from './Modal'
import { useNotify } from './Notify'
import { SettingsMenu } from './SettingsMenu'

interface Props {
  roomId: string
  userId: string
  userName: string
  onRename: (name: string) => Promise<void>
  onExit: () => void
}

type Tab = 'map' | 'laps'
type Info = 'wake' | 'geo' | null

export function RoomScreen({ roomId, userId, userName, onRename, onExit }: Props) {
  const notify = useNotify()
  const data = useRoom(roomId, userId, userName)
  const { room, members, laps, messages, positions, online } = data
  const [tab, setTab] = useState<Tab>('map')
  const [now, setNow] = useState(Date.now())
  const [settings, setSettings] = useState(false)
  const [editingLine, setEditingLine] = useState(false)
  const [info, setInfo] = useState<Info>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const onCrossing = useCallback(
    (res: string) => {
      if (res === 'ok') void data.loadLaps()
    },
    [data.loadLaps],
  )
  const { moving, geoStatus } = useTracker({
    room,
    userId,
    sendPos: data.sendPos,
    setOwnPos: data.setOwnPos,
    onCrossing,
  })
  const wake = useWakeLock(true)

  if (data.loadError) {
    return (
      <div className="page">
        <p>{data.loadError}</p>
        <button className="btn block" onClick={onExit}>
          ホームへ戻る
        </button>
      </div>
    )
  }
  if (!room) return <div className="page center">読み込み中…</div>

  const isOwner = room.owner_id === userId
  const nameOf = (uid: string | null) => (uid ? members.find((m) => m.user_id === uid)?.name ?? null : null)

  // 現在のライダー：走行中のメンバー（複数なら速い方）、いなければ最後に通過した人
  const movingNow = Object.values(positions).filter(
    (p) => p.moving && now - p.receivedAt <= STALE_MARKER_SEC * 1000,
  )
  movingNow.sort((a, b) => (b.spd ?? 0) - (a.spd ?? 0))
  const riderId = movingNow[0]?.uid ?? room.last_crosser_id

  const saveLine = async (line: ControlLine) => {
    const { error } = await supabase.rpc('set_line', {
      p_room: room.id,
      p_a_lat: line.a.lat,
      p_a_lng: line.a.lng,
      p_b_lat: line.b.lat,
      p_b_lng: line.b.lng,
    })
    if (error) notify(errorText(error), 'error')
    else {
      notify('コントロールラインを保存しました')
      setEditingLine(false)
      void data.loadRoom()
    }
  }

  const leave = async () => {
    const { error } = await supabase.from('room_members').delete().eq('room_id', room.id).eq('user_id', userId)
    if (error) notify(errorText(error), 'error')
    else onExit()
  }

  return (
    <div className="room">
      <Header
        room={room}
        now={now}
        lapCount={laps.length}
        riderName={nameOf(riderId)}
        riderIsMe={riderId === userId}
        meMoving={moving}
        wake={wake}
        geo={geoStatus}
        connected={data.connected}
        onWakeInfo={() => setInfo('wake')}
        onGeoInfo={() => setInfo('geo')}
        onSettings={() => setSettings(true)}
      />
      <nav className="tabs">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
          マップ
        </button>
        <button className={tab === 'laps' ? 'active' : ''} onClick={() => setTab('laps')}>
          ラップ
        </button>
      </nav>
      <main className="content">
        <MapView
          visible={tab === 'map'}
          members={members}
          positions={positions}
          online={online}
          riderId={riderId}
          line={roomLine(room)}
          now={now}
          editing={editingLine}
          onSaveLine={(l) => void saveLine(l)}
          onCancelEdit={() => setEditingLine(false)}
        />
        <LapTable
          visible={tab === 'laps'}
          laps={laps}
          now={now}
          isOwner={isOwner}
          members={members}
          onChanged={() => void data.loadLaps()}
        />
      </main>
      <ChatArea messages={messages} />
      <QuickButtons roomId={room.id} userId={userId} />

      {settings && (
        <SettingsMenu
          room={room}
          isOwner={isOwner}
          userName={userName}
          onClose={() => setSettings(false)}
          onRename={onRename}
          onEditLine={() => {
            setTab('map')
            setEditingLine(true)
          }}
          onLeave={() => void leave()}
          onChanged={() => {
            void data.loadRoom()
            void data.loadLaps()
          }}
        />
      )}

      {info === 'wake' && (
        <Modal title="画面の点灯" onClose={() => setInfo(null)}>
          {wake === 'active' ? (
            <p>画面が自動で消えないように設定されています。</p>
          ) : (
            <p>
              この端末では画面の点灯を維持できませんでした。走行中は画面を手動で消さないでください。
              {wake === 'unsupported' && '（iOS は 18.4 以降の Safari で直接開いてください）'}
            </p>
          )}
          <p className="hint">電源ボタンでロックしたり別のアプリに切り替えたりすると、位置の送信とラップの計測が止まります。</p>
        </Modal>
      )}
      {info === 'geo' && (
        <Modal title="位置情報" onClose={() => setInfo(null)}>
          <p>
            {geoStatus === 'denied' && '位置情報の利用が許可されていません。ブラウザの設定でこのサイトの位置情報を許可してください。'}
            {geoStatus === 'unavailable' && '位置情報を取得できません。空が見える場所で、端末の位置情報サービスがオンになっているか確認してください。'}
            {geoStatus === 'unsupported' && 'このブラウザは位置情報に対応していません。'}
          </p>
        </Modal>
      )}
    </div>
  )
}
