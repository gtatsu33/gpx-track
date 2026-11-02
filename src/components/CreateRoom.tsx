import { useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { useNotify } from './Notify'

interface Props {
  onBack: () => void
  onEnter: (roomId: string) => void
}

export function CreateRoom({ onBack, onEnter }: Props) {
  const [passcode, setPasscode] = useState('')
  const [team, setTeam] = useState('')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [minLap, setMinLap] = useState('30')
  const [kmh, setKmh] = useState('15')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null)
  const notify = useNotify()

  const submit = async () => {
    const teamName = team.trim()
    const ml = Number(minLap)
    const sp = Number(kmh)
    const dur = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
    if (!passcode) return notify('オーナーパスコードを入力してください', 'error')
    if (!teamName || teamName.length > 30) return notify('チーム名は1〜30文字です', 'error')
    if (!(ml >= 10 && ml <= 600)) return notify('最小ラップ秒数は10〜600です', 'error')
    if (!(sp >= 3 && sp <= 100)) return notify('判定速度は3〜100km/hです', 'error')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_room', {
      p_passcode: passcode,
      p_team_name: teamName,
      p_duration_min: dur > 0 ? dur : null,
      p_min_lap_sec: Math.round(ml),
      p_moving_kmh: Math.round(sp),
    })
    setBusy(false)
    if (error) notify(errorText(error), 'error')
    else setCreated(data as { id: string; code: string })
  }

  if (created) {
    return (
      <div className="page">
        <h1>ルームを作成しました</h1>
        <p className="lead">メンバーにこの参加コードを伝えてください。</p>
        <div className="big-code">{created.code}</div>
        <button
          className="btn block"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(created.code)
              notify('コピーしました')
            } catch {
              notify('コピーできませんでした', 'error')
            }
          }}
        >
          コードをコピー
        </button>
        <button className="btn primary block" onClick={() => onEnter(created.id)}>
          ルームへ進む
        </button>
        <p className="hint">コントロールラインは、ルーム画面の ⚙ メニューから設定します。</p>
      </div>
    )
  }

  return (
    <div className="page">
      <button className="back" onClick={onBack}>
        ← 戻る
      </button>
      <h1>ルームを作成</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>オーナーパスコード</span>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
        <label className="field">
          <span>チーム名（1〜30文字）</span>
          <input value={team} maxLength={30} onChange={(e) => setTeam(e.target.value)} />
        </label>
        <div className="field">
          <span>レース時間（任意）</span>
          <div className="row">
            <input type="number" inputMode="numeric" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
            <span>時間</span>
            <input type="number" inputMode="numeric" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <span>分</span>
          </div>
        </div>
        <label className="field">
          <span>最小ラップ秒数（10〜600）</span>
          <input type="number" inputMode="numeric" value={minLap} onChange={(e) => setMinLap(e.target.value)} />
        </label>
        <label className="field">
          <span>判定速度 km/h（3〜100）</span>
          <input type="number" inputMode="numeric" value={kmh} onChange={(e) => setKmh(e.target.value)} />
        </label>
        <button className="btn primary block" disabled={busy}>
          作成
        </button>
      </form>
    </div>
  )
}
