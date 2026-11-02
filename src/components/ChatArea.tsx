import { useEffect, useRef, useState } from 'react'
import { QUICK_BUTTON_COOLDOWN_MS, QUICK_MESSAGES } from '../config'
import { formatHM } from '../lib/format'
import { errorText, supabase } from '../lib/supabase'
import type { ChatMessage } from '../lib/types'
import { useNotify } from './Notify'

export function ChatArea({ messages }: { messages: ChatMessage[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastId = messages.length ? messages[messages.length - 1].id : 0
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  return (
    <div className="chat" ref={ref}>
      {messages.map((m) =>
        m.kind === 'system' ? (
          <div key={m.id} className="msg system">
            <span className="body">{m.body}</span>
            <span className="time">{formatHM(m.created_at)}</span>
          </div>
        ) : (
          <div key={m.id} className="msg">
            <span className="body">
              <b>{m.name}:</b> {m.body}
            </span>
            <span className="time">{formatHM(m.created_at)}</span>
          </div>
        ),
      )}
      {messages.length === 0 && <div className="msg system">メッセージはまだありません</div>}
    </div>
  )
}

export function QuickButtons({ roomId, userId }: { roomId: string; userId: string }) {
  const [cooling, setCooling] = useState<Record<string, boolean>>({})
  const notify = useNotify()

  const send = async (body: string) => {
    setCooling((c) => ({ ...c, [body]: true }))
    window.setTimeout(() => setCooling((c) => ({ ...c, [body]: false })), QUICK_BUTTON_COOLDOWN_MS)
    const { error } = await supabase.from('messages').insert({ room_id: roomId, user_id: userId, body })
    if (error) notify(errorText(error), 'error')
  }

  return (
    <div className="quick">
      {QUICK_MESSAGES.map((m) => (
        <button key={m} className="quick-btn" disabled={cooling[m]} onClick={() => void send(m)}>
          {m}
        </button>
      ))}
    </div>
  )
}
