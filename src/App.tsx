import { useState } from 'react'
import { CreateRoom } from './components/CreateRoom'
import { Home } from './components/Home'
import { NameSetup } from './components/NameSetup'
import { NotifyProvider } from './components/Notify'
import { ReclaimOwner } from './components/ReclaimOwner'
import { RoomScreen } from './components/RoomScreen'
import { useAuth } from './hooks/useAuth'
import { supabaseConfigured } from './lib/supabase'

type Screen = 'home' | 'create' | 'reclaim' | 'room'
const CURRENT_ROOM_KEY = 'gpx-track.currentRoom'

function readCurrentRoom(): string | null {
  try {
    return localStorage.getItem(CURRENT_ROOM_KEY)
  } catch {
    return null
  }
}
function writeCurrentRoom(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_ROOM_KEY, id)
    else localStorage.removeItem(CURRENT_ROOM_KEY)
  } catch {
    /* noop */
  }
}

function AppInner() {
  const auth = useAuth()
  const initialCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? ''
  const [roomId, setRoomId] = useState<string | null>(() => (initialCode ? null : readCurrentRoom()))
  const [screen, setScreen] = useState<Screen>(() => (roomId ? 'room' : 'home'))

  if (!supabaseConfigured) {
    return (
      <div className="page">
        <h1>設定が必要です</h1>
        <p>VITE_SUPABASE_URL と VITE_SUPABASE_PUBLISHABLE_KEY を .env.local に設定してからビルドしてください。</p>
      </div>
    )
  }
  if (auth.loading) return <div className="page center">読み込み中…</div>
  if (!auth.userId || !auth.name) return <NameSetup onRegister={auth.register} />

  const enter = (id: string) => {
    writeCurrentRoom(id)
    setRoomId(id)
    setScreen('room')
  }
  const goHome = () => {
    writeCurrentRoom(null)
    setRoomId(null)
    setScreen('home')
  }

  switch (screen) {
    case 'create':
      return <CreateRoom onBack={goHome} onEnter={enter} />
    case 'reclaim':
      return <ReclaimOwner onBack={goHome} onEnter={enter} />
    case 'room':
      if (roomId)
        return (
          <RoomScreen
            key={roomId}
            roomId={roomId}
            userId={auth.userId}
            userName={auth.name}
            onRename={auth.rename}
            onExit={goHome}
          />
        )
      return null
    default:
      return (
        <Home
          userName={auth.name}
          initialCode={initialCode}
          onEnter={enter}
          onCreate={() => setScreen('create')}
          onReclaim={() => setScreen('reclaim')}
        />
      )
  }
}

export default function App() {
  return (
    <NotifyProvider>
      <AppInner />
    </NotifyProvider>
  )
}
