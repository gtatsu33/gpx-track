import { useState } from 'react'
import { errorText } from '../lib/supabase'
import { APP_VERSION } from '../version'
import { useNotify } from './Notify'

export function NameSetup({ onRegister }: { onRegister: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  const trimmed = name.trim()

  const submit = async () => {
    if (!trimmed || trimmed.length > 20) return
    setBusy(true)
    try {
      await onRegister(trimmed)
    } catch (e) {
      notify(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1 className="brand">🏁 gpx-track</h1>
      <p className="lead">チーム内であなたを識別するための名前を入力してください。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>名前（1〜20文字）</span>
          <input
            value={name}
            maxLength={20}
            placeholder="例：佐藤"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <button className="btn primary block" disabled={busy || !trimmed}>
          はじめる
        </button>
      </form>
      <ul className="notes">
        <li>入力した名前は、マップの名前ラベル、ラップ表、チャットに表示されます。</li>
        <li>あとから変える場合は、ルームに入って ⚙ メニューの「名前の変更」から変更できます。</li>
      </ul>
      <footer className="version">v{APP_VERSION}</footer>
    </div>
  )
}
