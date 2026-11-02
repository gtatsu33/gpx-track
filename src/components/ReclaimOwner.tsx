import { useState } from 'react'
import { errorText, supabase } from '../lib/supabase'
import { useNotify } from './Notify'

interface Props {
  onBack: () => void
  onEnter: (roomId: string) => void
}

/** ブラウザのデータが消えて別人扱いになったオーナーが、権限を取り戻す */
export function ReclaimOwner({ onBack, onEnter }: Props) {
  const [code, setCode] = useState('')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const notify = useNotify()

  const submit = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('reclaim_owner', {
      p_code: code.trim().toUpperCase(),
      p_passcode: passcode,
    })
    setBusy(false)
    if (error) notify(errorText(error), 'error')
    else {
      notify('オーナー権限を復帰しました')
      onEnter(data as string)
    }
  }

  return (
    <div className="page">
      <button className="back" onClick={onBack}>
        ← 戻る
      </button>
      <h1>オーナー権限の復帰</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>参加コード</span>
          <input
            className="code-input"
            value={code}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          <span>オーナーパスコード</span>
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
        </label>
        <button className="btn primary block" disabled={busy || code.trim().length !== 6 || !passcode}>
          復帰する
        </button>
      </form>
    </div>
  )
}
