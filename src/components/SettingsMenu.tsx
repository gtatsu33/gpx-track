import { useState } from 'react'
import { toDatetimeLocal } from '../lib/format'
import { errorText, supabase } from '../lib/supabase'
import type { Room } from '../lib/types'
import { APP_VERSION } from '../version'
import { ConfirmModal, Modal } from './Modal'
import { useNotify } from './Notify'

interface Props {
  room: Room
  isOwner: boolean
  userName: string
  onClose: () => void
  onRename: (name: string) => Promise<void>
  onEditLine: () => void
  onLeave: () => void
  onChanged: () => void
}

type Confirm = 'start' | 'finish' | 'leave' | null

export function SettingsMenu({ room, isOwner, userName, onClose, onRename, onEditLine, onLeave, onChanged }: Props) {
  const notify = useNotify()
  const [name, setName] = useState(userName)
  const [startTime, setStartTime] = useState(room.started_at ? toDatetimeLocal(room.started_at) : '')
  const [manualTime, setManualTime] = useState(toDatetimeLocal(Date.now()))
  const [minLap, setMinLap] = useState(String(room.min_lap_sec))
  const [kmh, setKmh] = useState(String(room.moving_kmh))
  const [confirm, setConfirm] = useState<Confirm>(null)

  const rpc = async (fn: string, args: Record<string, unknown>, okMsg: string) => {
    const { error } = await supabase.rpc(fn, args)
    if (error) {
      notify(errorText(error), 'error')
      return false
    }
    notify(okMsg)
    onChanged()
    return true
  }

  const parseLocal = (s: string) => {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (confirm === 'start')
    return (
      <ConfirmModal
        title="レース開始"
        message="開始時刻を今にして、レースを開始します。"
        okLabel="開始"
        onCancel={() => setConfirm(null)}
        onOk={() => void rpc('start_race', { p_room: room.id }, 'レースを開始しました').then(onClose)}
      />
    )
  if (confirm === 'finish')
    return (
      <ConfirmModal
        title="レース終了"
        message="レースを終了します。以降のラップは記録されません。"
        okLabel="終了"
        danger
        onCancel={() => setConfirm(null)}
        onOk={() => void rpc('finish_race', { p_room: room.id }, 'レースを終了しました').then(onClose)}
      />
    )
  if (confirm === 'leave')
    return (
      <ConfirmModal
        title="ルームから退出"
        message="このルームから退出します。参加コードで再び参加できます。"
        okLabel="退出"
        danger
        onCancel={() => setConfirm(null)}
        onOk={onLeave}
      />
    )

  return (
    <Modal title="設定" onClose={onClose}>
      <section className="menu-sec">
        <h3>名前の変更</h3>
        <div className="row">
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button
            className="btn"
            disabled={!name.trim() || name.trim() === userName}
            onClick={async () => {
              try {
                await onRename(name.trim())
                notify('名前を変更しました')
              } catch (e) {
                notify(errorText(e), 'error')
              }
            }}
          >
            変更
          </button>
        </div>
      </section>

      <section className="menu-sec">
        <h3>参加コード</h3>
        <div className="row">
          <span className="code-show">{room.code}</span>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(room.code)
                notify('コピーしました')
              } catch {
                notify('コピーできませんでした', 'error')
              }
            }}
          >
            コピー
          </button>
        </div>
      </section>

      {isOwner && (
        <>
          <section className="menu-sec owner">
            <h3>オーナー：コース</h3>
            <button
              className="btn block"
              onClick={() => {
                onEditLine()
                onClose()
              }}
            >
              コントロールラインの設定
            </button>
            <div className="field">
              <span>判定速度 km/h（3〜100）／最小ラップ秒数（10〜600）</span>
              <div className="row">
                <input type="number" inputMode="numeric" value={kmh} onChange={(e) => setKmh(e.target.value)} />
                <input type="number" inputMode="numeric" value={minLap} onChange={(e) => setMinLap(e.target.value)} />
                <button
                  className="btn"
                  onClick={() => {
                    const k = Number(kmh)
                    const ml = Number(minLap)
                    if (!(k >= 3 && k <= 100) || !(ml >= 10 && ml <= 600)) {
                      notify('値の範囲を確認してください', 'error')
                      return
                    }
                    void rpc(
                      'update_room_settings',
                      { p_room: room.id, p_min_lap_sec: Math.round(ml), p_moving_kmh: Math.round(k) },
                      '設定を保存しました',
                    )
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </section>

          <section className="menu-sec owner">
            <h3>オーナー：レース</h3>
            {room.status === 'ready' && (
              <button className="btn primary block" onClick={() => setConfirm('start')}>
                レース開始
              </button>
            )}
            {room.status !== 'ready' && (
              <>
                <div className="field">
                  <span>開始時刻の修正</span>
                  <div className="row">
                    <input type="datetime-local" step={1} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    <button
                      className="btn"
                      onClick={() => {
                        const d = parseLocal(startTime)
                        if (!d) return notify('時刻が正しくありません', 'error')
                        void rpc('set_start_time', { p_room: room.id, p_ts: d.toISOString() }, '開始時刻を修正しました')
                      }}
                    >
                      修正
                    </button>
                  </div>
                </div>
                <div className="field">
                  <span>手動で通過を記録</span>
                  <div className="row">
                    <input type="datetime-local" step={1} value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
                    <button className="btn" onClick={() => setManualTime(toDatetimeLocal(Date.now()))}>
                      今
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        const d = parseLocal(manualTime)
                        if (!d) return notify('時刻が正しくありません', 'error')
                        void rpc('add_manual_crossing', { p_room: room.id, p_crossed_at: d.toISOString() }, '通過を記録しました')
                      }}
                    >
                      記録
                    </button>
                  </div>
                </div>
              </>
            )}
            {room.status === 'running' && (
              <button className="btn danger block" onClick={() => setConfirm('finish')}>
                レース終了
              </button>
            )}
          </section>
        </>
      )}

      <section className="menu-sec">
        <button className="btn block subtle" onClick={() => setConfirm('leave')}>
          ルームから退出
        </button>
        <p className="version">gpx-track v{APP_VERSION}</p>
      </section>
    </Modal>
  )
}
