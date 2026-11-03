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
  /** オーナーのライダー。今のライダーがこれになっている端末がオーナーモード */
  owner_rider_id: string | null
  last_crosser_rider_id: string | null
  created_at: string
}

/** 名簿のライダー（端末とは別。ルームごと） */
export interface Rider {
  id: string
  name: string
  /** 参加時に自動で作った本人のライダーなら、その端末のユーザー */
  user_id: string | null
}

/** 端末（匿名ユーザー） */
export interface Member {
  user_id: string
  color_idx: number
  /** その端末の今のライダー */
  rider_id: string | null
  /** 今のライダーの名前（なければプロフィールの名前） */
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
  /** ラップのライダー（riders.id） */
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
  /** その端末の今のライダー */
  rid: string | null
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

/** 名簿の表示名。オーナーのライダーには「(オーナー)」を付ける */
export function riderLabel(rider: Rider, room: Room | null): string {
  return room?.owner_rider_id === rider.id ? `${rider.name} (オーナー)` : rider.name
}
