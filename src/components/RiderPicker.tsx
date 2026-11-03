import { useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { riderLabel, type Rider, type Room } from '../lib/types'
import { Modal } from './Modal'
import { useNotify } from './Notify'

interface Props {
  room: Room
  riders: Rider[]
  /** この端末の今のライダー */
  myRiderId: string | null
  onClose: () => void
  onChanged: () => void
}

/** この端末のライダーを名簿から選ぶ／追加する。オーナーを選ぶときはパスコードを聞く */
export function RiderPicker({ room, riders, myRiderId, onClose, onChanged }: Props) {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [askPass, setAskPass] = useState<Rider | null>(null)
  const [passcode, setPasscode] = useState('')

  // オーナーを先頭に、あとは名簿の順
  const list = [...riders].sort(
    (a, b) => Number(b.id === room.owner_rider_id) - Number(a.id === room.owner_rider_id),
  )

  const done = (msg: string) => {
    notify(msg)
    onChanged()
    onClose()
  }

  const switchTo = async (rider: Rider, pass: string | null) => {
    setBusy(true)
    const { error } = await supabase.rpc('switch_rider', {
      p_room: room.id,
      p_rider: rider.id,
      p_passcode: pass,
    })
    setBusy(false)
    if (error) notify(errorText(error), 'error')
    else done(rider.id === room.owner_rider_id ? `${rider.name} に切り替えました（オーナーモード）` : `${rider.name} に切り替えました`)
  }

  const pick = (rider: Rider) => {
    if (rider.id === myRiderId) return onClose()
    if (rider.id === room.owner_rider_id) {
      setPasscode('')
      setAskPass(rider)
    } else void switchTo(rider, null)
  }

  const add = async () => {
    const n = newName.trim()
    if (!n) return
    setBusy(true)
    const { error } = await supabase.rpc('add_rider', { p_room: room.id, p_name: n })
    setBusy(false)
    if (error) notify(errorText(error), 'error')
    else done(`${n} を追加して切り替えました`)
  }

  if (askPass) {
    return (
      <Modal title="オーナーに切り替え" onClose={() => setAskPass(null)}>
        <p>
          {askPass.name} (オーナー) に切り替えると、この端末がオーナーモードになります。オーナーパスコードを入力してください。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (passcode) void switchTo(askPass, passcode)
          }}
        >
          <label className="field">
            <span>オーナーパスコード</span>
            <input type="password" value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setAskPass(null)}>
              戻る
            </button>
            <button className="btn primary" disabled={busy || !passcode}>
              切り替え
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  return (
    <Modal title="この端末のライダー" onClose={onClose}>
      <p className="hint">この端末で走る人を選んでください。ラップと走行距離は選んだ人の分として記録されます。</p>
      <div className="member-pick">
        {list.map((r) => (
          <button
            key={r.id}
            className={`btn ${r.id === myRiderId ? 'primary' : ''}`}
            disabled={busy}
            onClick={() => pick(r)}
          >
            {riderLabel(r, room)}
          </button>
        ))}
      </div>
      <h3>ライダーを追加</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={newName} maxLength={20} placeholder="例：田中" onChange={(e) => setNewName(e.target.value)} />
        <button className="btn" disabled={busy || !newName.trim()}>
          追加
        </button>
      </form>
    </Modal>
  )
}
