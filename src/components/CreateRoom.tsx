import { useState } from 'react'
import { SOLO_MAX_MEMBERS } from '../config'
import { errorText, supabase } from '../lib/supabase'
import type { RoomMode } from '../lib/types'
import { useNotify } from './Notify'

interface Props {
  onBack: () => void
  onEnter: (roomId: string) => void
}

export function CreateRoom({ onBack, onEnter }: Props) {
  const [mode, setMode] = useState<RoomMode>('team')
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
    const nameLabel = mode === 'solo' ? 'ルーム名' : 'チーム名'
    if (!teamName || teamName.length > 30) return notify(`${nameLabel}は1〜30文字です`, 'error')
    if (!(ml >= 10 && ml <= 600)) return notify('最小ラップ秒数は10〜600です', 'error')
    if (!(sp >= 3 && sp <= 100)) return notify('判定速度は3〜100km/hです', 'error')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_room', {
      p_passcode: passcode,
      p_team_name: teamName,
      p_duration_min: dur > 0 ? dur : null,
      p_min_lap_sec: Math.round(ml),
      p_moving_kmh: Math.round(sp),
      p_mode: mode,
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
        <div className="field">
          <span>モード</span>
          <div className="mode-pick">
            {(['team', 'solo'] as RoomMode[]).map((m) => (
              <label key={m} className={mode === m ? 'on' : ''}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === 'team' ? '団体戦（リレー形式）' : '個人戦'}
              </label>
            ))}
          </div>
          <small className="hint">
            {mode === 'team'
              ? 'チームの1人が交代で走り、チームで通算した周回数を競います。'
              : `参加者全員が同時に走り、1人ずつの周回数と順位を競います（${SOLO_MAX_MEMBERS}台まで）。`}
          </small>
        </div>
        <label className="field">
          <span>オーナーパスコード</span>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
        <label className="field">
          <span>{mode === 'solo' ? 'ルーム名（大会名など。1〜30文字）' : 'チーム名（1〜30文字）'}</span>
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
