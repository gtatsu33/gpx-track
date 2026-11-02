import type { LatLng } from './geo'

/** 端末で得た1回分の測位 */
export interface Fix {
  lat: number
  lng: number
  /** 測位時刻（ms, epoch） */
  t: number
  /** 精度（m） */
  acc: number
  /** 速度（m/s）。端末が出さない場合は null */
  speed: number | null
}

export interface ControlLine {
  a: LatLng
  b: LatLng
}

export type RoomStatus = 'ready' | 'running' | 'finished'

export interface Room {
  id: string
  code: string
  team_name: string
  owner_id: string | null
  duration_min: number | null
  min_lap_sec: number
  moving_kmh: number
  line_a_lat: number | null
  line_a_lng: number | null
  line_b_lat: number | null
  line_b_lng: number | null
  status: RoomStatus
  started_at: string | null
  finished_at: string | null
  last_crosser_id: string | null
  created_at: string
}

export interface Member {
  user_id: string
  color_idx: number
  name: string
}

export interface ChatMessage {
  id: number
  room_id: string
  user_id: string | null
  name: string
  body: string
  kind: 'user' | 'system'
  created_at: string
}

/** get_lap_table の1行 */
export interface LapRow {
  lap_no: number
  crossing_id: string
  crossed_at: string
  lap_ms: number | null
  driver_id: string | null
  driver_name: string
  driver_meters: number | null
  source: 'gps' | 'manual'
  is_override: boolean
  crosser_id: string | null
}

/** メンバー間で共有する位置（broadcast pos） */
export interface PosPayload {
  uid: string
  lat: number
  lng: number
  acc: number
  spd: number | null
  moving: boolean
  t: number
}

export function roomLine(room: Room | null): ControlLine | null {
  if (
    !room ||
    room.line_a_lat == null ||
    room.line_a_lng == null ||
    room.line_b_lat == null ||
    room.line_b_lng == null
  )
    return null
  return {
    a: { lat: room.line_a_lat, lng: room.line_a_lng },
    b: { lat: room.line_b_lat, lng: room.line_b_lng },
  }
}
