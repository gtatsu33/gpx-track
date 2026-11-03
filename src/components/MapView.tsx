import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { MEMBER_COLORS, STALE_MARKER_SEC } from '../config'
import { midpoint, type LatLng } from '../lib/geo'
import type { ControlLine, Member } from '../lib/types'
import type { PosState } from '../hooks/useRoom'

interface Props {
  visible: boolean
  members: Member[]
  positions: Record<string, PosState>
  online: Set<string>
  riderId: string | null
  line: ControlLine | null
  now: number
  editing: boolean
  onSaveLine: (line: ControlLine) => void
  onCancelEdit: () => void
  /** マーカーの名前ラベル（個人戦は「名前 周回数」）。省略時は名前だけ */
  labelOf?: (m: Member) => string
  /** 追従ボタンの文言（団体戦「ライダー追従」、個人戦「自分を追従」） */
  followLabel?: string
  /** 追従の初期値 */
  initialFollow?: boolean
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function memberIcon(name: string, color: string, kind: 'rider' | 'moving' | 'normal' | 'stale') {
  const size = kind === 'rider' ? 26 : 18
  return L.divIcon({
    className: 'mk-wrap',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="mk mk-${kind}" style="--c:${kind === 'stale' ? '#9ca3af' : color}"><span class="dot"></span><span class="lbl">${esc(name)}</span></div>`,
  })
}

function MemberMarker(props: { pos: LatLng; name: string; color: string; kind: 'rider' | 'moving' | 'normal' | 'stale' }) {
  const icon = useMemo(() => memberIcon(props.name, props.color, props.kind), [props.name, props.color, props.kind])
  return (
    <Marker
      position={[props.pos.lat, props.pos.lng]}
      icon={icon}
      zIndexOffset={props.kind === 'rider' ? 1000 : 0}
      interactive={false}
    />
  )
}

/** 地図の追従・全員表示・サイズ再計算 */
function Controller(props: {
  visible: boolean
  follow: boolean
  riderPos: LatLng | null
  fitTick: number
  fitPoints: LatLng[]
}) {
  const map = useMap()
  useEffect(() => {
    if (props.visible) setTimeout(() => map.invalidateSize(), 0)
  }, [props.visible, map])
  useEffect(() => {
    if (props.follow && props.riderPos) map.panTo([props.riderPos.lat, props.riderPos.lng], { animate: true })
  }, [props.follow, props.riderPos?.lat, props.riderPos?.lng, map])
  useEffect(() => {
    if (props.fitTick === 0 || props.fitPoints.length === 0) return
    if (props.fitPoints.length === 1) map.setView([props.fitPoints[0].lat, props.fitPoints[0].lng], 17)
    else map.fitBounds(L.latLngBounds(props.fitPoints.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 18 })
    // fitTick が変わったときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitTick, map])
  return null
}

/** コントロールラインの編集（地図を2回タップ） */
function LineEditor(props: { points: LatLng[]; onTap: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => props.onTap({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return (
    <>
      {props.points.map((p, i) => (
        <CircleMarker key={i} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: '#2563eb', weight: 3 }} />
      ))}
      {props.points.length === 2 && (
        <Polyline
          positions={props.points.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: '#2563eb', weight: 5, dashArray: '8 6' }}
        />
      )}
    </>
  )
}

export function MapView(p: Props) {
  const [follow, setFollow] = useState(p.initialFollow ?? true)
  const [fitTick, setFitTick] = useState(0)
  const [editPts, setEditPts] = useState<LatLng[]>([])

  useEffect(() => {
    if (p.editing) {
      setEditPts([])
      setFollow(false)
    }
  }, [p.editing])

  const initial = useRef<{ center: [number, number]; zoom: number } | null>(null)
  if (!initial.current) {
    const firstPos = Object.values(p.positions)[0]
    if (p.line) {
      const m = midpoint(p.line.a, p.line.b)
      initial.current = { center: [m.lat, m.lng], zoom: 16 }
    } else if (firstPos) initial.current = { center: [firstPos.lat, firstPos.lng], zoom: 16 }
    else initial.current = { center: [36.2, 138.25], zoom: 5 }
  }

  const memberById = new Map(p.members.map((m) => [m.user_id, m]))
  const riderPos = p.riderId ? p.positions[p.riderId] ?? null : null
  const riderLatLng = riderPos ? { lat: riderPos.lat, lng: riderPos.lng } : null
  const fitPoints = Object.values(p.positions).map((x) => ({ lat: x.lat, lng: x.lng }))
  if (p.line) fitPoints.push(p.line.a, p.line.b)

  return (
    <div className="map-wrap" style={{ display: p.visible ? 'block' : 'none' }}>
      <MapContainer center={initial.current.center} zoom={initial.current.zoom} className="map" zoomControl={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <Controller visible={p.visible} follow={follow && !p.editing} riderPos={riderLatLng} fitTick={fitTick} fitPoints={fitPoints} />

        {p.line && !p.editing && (
          <Polyline
            positions={[
              [p.line.a.lat, p.line.a.lng],
              [p.line.b.lat, p.line.b.lng],
            ]}
            pathOptions={{ color: '#dc2626', weight: 5 }}
          />
        )}

        {riderPos && riderPos.trail.length > 1 && (
          <Polyline
            positions={riderPos.trail.map((t) => [t.lat, t.lng] as [number, number])}
            pathOptions={{
              color: MEMBER_COLORS[(memberById.get(p.riderId!)?.color_idx ?? 0) % MEMBER_COLORS.length],
              weight: 4,
              opacity: 0.6,
            }}
          />
        )}

        {Object.values(p.positions).map((pos) => {
          const m = memberById.get(pos.uid)
          if (!m || m.spectator) return null // 走らない端末は表示しない
          const stale = p.now - pos.receivedAt > STALE_MARKER_SEC * 1000 || !p.online.has(pos.uid)
          const kind = stale ? 'stale' : pos.uid === p.riderId ? 'rider' : pos.moving ? 'moving' : 'normal'
          return (
            <MemberMarker
              key={pos.uid}
              pos={pos}
              name={p.labelOf ? p.labelOf(m) : m.name}
              color={MEMBER_COLORS[m.color_idx % MEMBER_COLORS.length]}
              kind={kind}
            />
          )
        })}

        {p.editing && <LineEditor points={editPts} onTap={(pt) => setEditPts((x) => (x.length >= 2 ? [pt] : [...x, pt]))} />}
      </MapContainer>

      {!p.editing && (
        <div className="map-buttons">
          <button className="map-btn" onClick={() => setFitTick((n) => n + 1)}>
            全員表示
          </button>
          <button className={`map-btn ${follow ? 'on' : ''}`} onClick={() => setFollow((f) => !f)}>
            {p.followLabel ?? 'ライダー追従'} {follow ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {p.editing && (
        <div className="line-panel">
          <p>
            {editPts.length === 0 && '端点Aをタップしてください'}
            {editPts.length === 1 && '端点Bをタップしてください'}
            {editPts.length === 2 && 'この線で保存しますか？'}
            <br />
            <small>コースの幅より左右に少し長めに引いてください。</small>
          </p>
          <div className="row">
            <button className="btn" onClick={p.onCancelEdit}>
              キャンセル
            </button>
            <button className="btn" onClick={() => setEditPts([])} disabled={editPts.length === 0}>
              やり直し
            </button>
            <button
              className="btn primary"
              disabled={editPts.length !== 2}
              onClick={() => p.onSaveLine({ a: editPts[0], b: editPts[1] })}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
