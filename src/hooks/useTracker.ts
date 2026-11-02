// 走行状態・位置の送信・通過の記録・走行距離の記録（implement.txt ■4, ■5）
import { useEffect, useRef, useState } from 'react'
import {
  DISTANCE_FLUSH_SEC,
  LINE_EXTEND_M,
  MAX_ACCURACY_M,
  MAX_GAP_SEC,
  MOVING_OFF_SEC,
  MOVING_ON_SEC,
  POS_INTERVAL_MOVING_MS,
  POS_INTERVAL_PIT_MS,
  QUEUE_RETRY_MS,
} from '../config'
import { flushQueue, sendOrQueue } from '../lib/crossingQueue'
import { LapDetector, kmhToMps } from '../lib/lapDetector'
import { MovingTracker } from '../lib/movingState'
import { roomLine, type Fix, type PosPayload, type Room } from '../lib/types'
import { useGeolocation } from './useGeolocation'

interface Options {
  room: Room | null
  userId: string
  sendPos: (p: PosPayload) => void
  setOwnPos: (p: PosPayload) => void
  onCrossing?: (result: string) => void
}

export function useTracker({ room, userId, sendPos, setOwnPos, onCrossing }: Options) {
  const [moving, setMoving] = useState(false)
  const [lastFix, setLastFix] = useState<Fix | null>(null)

  const detector = useRef(new LapDetector(MAX_ACCURACY_M))
  const tracker = useRef(
    new MovingTracker({
      maxAccuracyM: MAX_ACCURACY_M,
      maxGapSec: MAX_GAP_SEC,
      onSec: MOVING_ON_SEC,
      offSec: MOVING_OFF_SEC,
    }),
  )
  const lastSentAt = useRef(0)
  const roomRef = useRef(room)
  roomRef.current = room
  const cbRef = useRef({ sendPos, setOwnPos, onCrossing })
  cbRef.current = { sendPos, setOwnPos, onCrossing }

  const line = roomLine(room)

  const handleFix = (fix: Fix) => {
    const r = roomRef.current
    if (!r) return
    const th = kmhToMps(r.moving_kmh)
    const accepted = tracker.current.feed(fix, th)
    setLastFix(fix)
    if (!accepted) return

    const isMoving = tracker.current.moving
    setMoving(isMoving)

    // 通過判定（自分の通過だけ）
    const t = detector.current.feed(
      fix,
      roomLine(r),
      { extendM: LINE_EXTEND_M, maxGapSec: MAX_GAP_SEC, minSpeedMps: th },
      r.min_lap_sec,
    )
    if (t != null && r.status === 'running' && r.started_at && t > Date.parse(r.started_at)) {
      void sendOrQueue({ kind: 'crossing', room: r.id, t }).then((res) => cbRef.current.onCrossing?.(res))
    }

    // 位置の送信（走行中5秒 / ピット10秒ごと）
    const payload: PosPayload = {
      uid: userId,
      lat: fix.lat,
      lng: fix.lng,
      acc: Math.round(fix.acc),
      spd: tracker.current.lastSpeed,
      moving: isMoving,
      t: fix.t,
    }
    const interval = isMoving ? POS_INTERVAL_MOVING_MS : POS_INTERVAL_PIT_MS
    const now = Date.now()
    if (now - lastSentAt.current >= interval) {
      lastSentAt.current = now
      cbRef.current.sendPos(payload)
    } else {
      cbRef.current.setOwnPos(payload)
    }
  }

  const geoStatus = useGeolocation(Boolean(room), line, handleFix)

  // ライン変更時は判定器をリセット
  const lineKey = line ? `${line.a.lat},${line.a.lng},${line.b.lat},${line.b.lng}` : ''
  useEffect(() => {
    detector.current.reset()
  }, [lineKey])

  // 走行距離をまとめて送る
  useEffect(() => {
    const id = window.setInterval(() => {
      const seg = tracker.current.flush()
      const r = roomRef.current
      if (!seg || !r || r.status !== 'running') return
      void sendOrQueue({ kind: 'segment', room: r.id, user: userId, from: seg.from, to: seg.to, meters: seg.meters })
    }, DISTANCE_FLUSH_SEC * 1000)
    return () => window.clearInterval(id)
  }, [userId])

  // 送れなかったデータの再送
  useEffect(() => {
    const retry = () => void flushQueue()
    retry()
    const id = window.setInterval(retry, QUEUE_RETRY_MS)
    window.addEventListener('online', retry)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('online', retry)
    }
  }, [])

  return { moving, lastFix, geoStatus }
}
