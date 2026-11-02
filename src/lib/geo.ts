// 緯度経度と平面座標（m）の変換、距離、線分の交差判定

export const EARTH_R = 6371008.8
const D2R = Math.PI / 180

export interface LatLng {
  lat: number
  lng: number
}

export interface XY {
  x: number
  y: number
}

/** 2点間の距離（m、ハーバーサイン） */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R
  const dLng = (b.lng - a.lng) * D2R
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** origin を原点とする正距円筒近似の平面座標へ変換する関数を返す */
export function makeProjector(origin: LatLng): (p: LatLng) => XY {
  const k = Math.cos(origin.lat * D2R)
  return (p) => ({
    x: (p.lng - origin.lng) * D2R * k * EARTH_R,
    y: (p.lat - origin.lat) * D2R * EARTH_R,
  })
}

/** 平面座標から緯度経度へ戻す */
export function makeUnprojector(origin: LatLng): (p: XY) => LatLng {
  const k = Math.cos(origin.lat * D2R)
  return (p) => ({
    lat: origin.lat + p.y / EARTH_R / D2R,
    lng: origin.lng + p.x / (EARTH_R * k) / D2R,
  })
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}

const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y })

/**
 * 線分 PQ と線分 AB の交差判定。
 * 交差すれば PQ 上の位置 t（0..1）と AB 上の位置 u（0..1）を返す。平行・非交差は null。
 */
export function segmentIntersection(p: XY, q: XY, a: XY, b: XY): { t: number; u: number } | null {
  const r = sub(q, p)
  const d = sub(b, a)
  const den = cross(r, d)
  if (Math.abs(den) < 1e-12) return null
  const ap = sub(a, p)
  const t = cross(ap, d) / den
  const u = cross(ap, r) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { t, u }
}

/** 線分 AB を両端で ext m ずつ延長した端点を返す（平面座標） */
export function extendSegment(a: XY, b: XY, ext: number): [XY, XY] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return [a, b]
  const ux = (dx / len) * ext
  const uy = (dy / len) * ext
  return [
    { x: a.x - ux, y: a.y - uy },
    { x: b.x + ux, y: b.y + uy },
  ]
}
