// ルームのデータ取得と Realtime（private チャネル room:<id>）の購読（implement.txt ■3.6）
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { CHAT_LIMIT, LAP_PROVISIONAL_SEC, TRAIL_SEC } from '../config'
import { supabase } from '../lib/supabase'
import type { ChatMessage, LapRow, Member, PosPayload, Rider, Room } from '../lib/types'

export interface PosState extends PosPayload {
  receivedAt: number
  trail: { lat: number; lng: number; t: number }[]
}

export function useRoom(roomId: string, userId: string, userName: string) {
  const [room, setRoom] = useState<Room | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [laps, setLaps] = useState<LapRow[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [positions, setPositions] = useState<Record<string, PosState>>({})
  const [online, setOnline] = useState<Set<string>>(new Set())
  const [connected, setConnected] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const loadRoom = useCallback(async () => {
    const { data, error } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle()
    if (error) return
    if (!data) setLoadError('ルームが見つからないか、メンバーではありません')
    else setRoom(data as Room)
  }, [roomId])

  /** 端末（メンバー）と名簿（ライダー）をまとめて取り直す */
  const loadMembers = useCallback(async () => {
    const [mRes, rRes] = await Promise.all([
      supabase
        .from('room_members')
        .select('user_id, color_idx, current_rider_id, profiles(name)')
        .eq('room_id', roomId)
        .order('joined_at'),
      supabase.from('riders').select('id, name, user_id').eq('room_id', roomId).order('created_at'),
    ])
    const rs = (rRes.data as Rider[] | null) ?? null
    if (rs) setRiders(rs)
    if (!mRes.data) return
    const riderName = new Map((rs ?? []).map((r) => [r.id, r.name]))
    setMembers(
      (
        mRes.data as unknown as {
          user_id: string
          color_idx: number
          current_rider_id: string | null
          profiles: { name: string } | null
        }[]
      ).map((m) => ({
        user_id: m.user_id,
        color_idx: m.color_idx,
        rider_id: m.current_rider_id,
        name: (m.current_rider_id && riderName.get(m.current_rider_id)) || m.profiles?.name || '?',
      })),
    )
  }, [roomId])

  const loadLaps = useCallback(async () => {
    const { data } = await supabase.rpc('get_lap_table', { p_room: roomId })
    if (data) setLaps(data as LapRow[])
  }, [roomId])

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('id', { ascending: false })
      .limit(CHAT_LIMIT)
    if (data) setMessages((data as ChatMessage[]).reverse())
  }, [roomId])

  const reloadAll = useCallback(() => {
    void loadRoom()
    void loadMembers()
    void loadLaps()
    void loadMessages()
  }, [loadRoom, loadMembers, loadLaps, loadMessages])

  const upsertPos = useCallback((p: PosPayload) => {
    const now = Date.now()
    setPositions((prev) => {
      const old = prev[p.uid]
      const trail = [...(old?.trail ?? []), { lat: p.lat, lng: p.lng, t: p.t }].filter(
        (x) => p.t - x.t <= TRAIL_SEC * 1000,
      )
      return { ...prev, [p.uid]: { ...p, receivedAt: now, trail } }
    })
  }, [])

  useEffect(() => {
    let disposed = false
    const timers: number[] = []
    let ch: RealtimeChannel | null = null

    const start = async () => {
      // Realtime Authorization 用にログイン中のトークンを渡す
      await supabase.realtime.setAuth()
      if (disposed) return
      ch = supabase.channel(`room:${roomId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: userId } },
      })
      ch.on('broadcast', { event: 'pos' }, (m) => upsertPos(m.payload as PosPayload))
        .on('broadcast', { event: 'message' }, (m) => {
          const msg = m.payload as ChatMessage
          setMessages((prev) =>
            prev.some((x) => x.id === msg.id) ? prev : [...prev, msg].slice(-CHAT_LIMIT),
          )
        })
        .on('broadcast', { event: 'crossing' }, () => {
          void loadLaps()
          // 遅れて届く走行距離でライダーを確定させるため、少し後にもう一度取得
          timers.push(window.setTimeout(() => void loadLaps(), (LAP_PROVISIONAL_SEC + 1) * 1000))
        })
        .on('broadcast', { event: 'room' }, () => void loadRoom())
        .on('broadcast', { event: 'member' }, () => void loadMembers())
        .on('presence', { event: 'sync' }, () => {
          if (ch) setOnline(new Set(Object.keys(ch.presenceState())))
        })
        .subscribe(async (status) => {
          if (disposed) return
          setConnected(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') {
            reloadAll() // 接続・再接続のたびに取りこぼしを埋める
            await ch?.track({ uid: userId, name: userName })
          }
        })
      channelRef.current = ch
    }

    reloadAll()
    void start()
    // 配信の取りこぼし対策として1分ごとにも取り直す
    const poll = window.setInterval(() => {
      void loadRoom()
      void loadLaps()
    }, 60000)

    return () => {
      disposed = true
      window.clearInterval(poll)
      timers.forEach((t) => window.clearTimeout(t))
      channelRef.current = null
      if (ch) void supabase.removeChannel(ch)
    }
    // userName の変更でチャネルを張り直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId])

  /** 自分の位置を配信（自分の表示にも反映） */
  const sendPos = useCallback(
    (p: PosPayload) => {
      upsertPos(p)
      const ch = channelRef.current
      if (ch) void ch.send({ type: 'broadcast', event: 'pos', payload: p })
    },
    [upsertPos],
  )

  /** 自分の位置を表示だけ更新（配信しない） */
  const setOwnPos = upsertPos

  return {
    room,
    members,
    riders,
    laps,
    messages,
    positions,
    online,
    connected,
    loadError,
    sendPos,
    setOwnPos,
    reloadAll,
    loadLaps,
    loadRoom,
    loadMembers,
  }
}
