import { useState } from 'react'
import { formatClock, formatLap } from '../lib/format'
import type { LapViewRow } from '../lib/laps'
import { errorText, supabase } from '../lib/supabase'
import { riderLabel, type Rider, type Room } from '../lib/types'
import { ConfirmModal, Modal } from './Modal'
import { useNotify } from './Notify'

interface Props {
  lap: LapViewRow
  room: Room
  riders: Rider[]
  onClose: () => void
  onDone: () => void
}

/** オーナー用：周の削除・名前の修正（名簿から選ぶ） */
export function LapRowMenu({ lap, room, riders, onClose, onDone }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const notify = useNotify()

  const run = async (fn: () => PromiseLike<{ error: unknown }>, okMsg: string) => {
    const { error } = await fn()
    if (error) notify(errorText(error), 'error')
    else {
      notify(okMsg)
      onDone()
    }
  }

  if (confirmDelete) {
    return (
      <ConfirmModal
        title="周の削除"
        message={`第${lap.lap_no}周（${formatClock(lap.crossed_at)}）を削除します。以降の周番号とラップタイムは再計算されます。`}
        okLabel="削除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onOk={() => void run(() => supabase.rpc('delete_crossing', { p_id: lap.crossing_id }), '削除しました')}
      />
    )
  }

  return (
    <Modal title={`第${lap.lap_no}周  ${formatLap(lap.lap_ms)}`} onClose={onClose}>
      <h3>名前の修正</h3>
      <div className="member-pick">
        {riders.map((r) => (
          <button
            key={r.id}
            className={`btn ${lap.driver_id === r.id ? 'primary' : ''}`}
            onClick={() =>
              void run(
                () => supabase.rpc('set_crossing_driver', { p_id: lap.crossing_id, p_rider: r.id }),
                '名前を修正しました',
              )
            }
          >
            {riderLabel(r, room)}
          </button>
        ))}
      </div>
      {lap.is_override && (
        <button
          className="btn block"
          onClick={() =>
            void run(
              () => supabase.rpc('set_crossing_driver', { p_id: lap.crossing_id, p_rider: null }),
              '自動判定に戻しました',
            )
          }
        >
          自動に戻す
        </button>
      )}
      <h3>削除</h3>
      <button className="btn danger block" onClick={() => setConfirmDelete(true)}>
        この周を削除
      </button>
    </Modal>
  )
}
