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
      <h1 className="brand">🏁 Pit Wall</h1>
      <p className="lead">チームメンバーに表示される名前を入力してください。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="field">
          <span>名前（1〜20文字）</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <button className="btn primary block" disabled={busy || !trimmed}>
          はじめる
        </button>
      </form>
      <footer className="version">v{APP_VERSION}</footer>
    </div>
  )
}
