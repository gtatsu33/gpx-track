import { describe, expect, it } from 'vitest'
import { distanceM, extendSegment, makeProjector, makeUnprojector, segmentIntersection } from '../src/lib/geo'

describe('geo', () => {
  it('distanceM: 緯度0.001度はおよそ111m', () => {
    const d = distanceM({ lat: 35, lng: 139 }, { lat: 35.001, lng: 139 })
    expect(d).toBeGreaterThan(110.5)
    expect(d).toBeLessThan(111.8)
  })

  it('平面化と逆変換で元に戻る', () => {
    const o = { lat: 35.37, lng: 138.93 }
    const proj = makeProjector(o)
    const unproj = makeUnprojector(o)
    const p = { lat: 35.372, lng: 138.935 }
    const back = unproj(proj(p))
    expect(back.lat).toBeCloseTo(p.lat, 9)
    expect(back.lng).toBeCloseTo(p.lng, 9)
  })

  it('平面化した距離はハーバーサインとほぼ一致', () => {
    const o = { lat: 35.37, lng: 138.93 }
    const proj = makeProjector(o)
    const p = { lat: 35.371, lng: 138.931 }
    const xy = proj(p)
    expect(Math.hypot(xy.x, xy.y)).toBeCloseTo(distanceM(o, p), 0)
  })

  it('segmentIntersection: 交差・非交差・平行', () => {
    const a = { x: 0, y: -5 }
    const b = { x: 0, y: 5 }
    expect(segmentIntersection({ x: -1, y: 0 }, { x: 3, y: 0 }, a, b)).toEqual({ t: 0.25, u: 0.5 })
    expect(segmentIntersection({ x: 1, y: 0 }, { x: 3, y: 0 }, a, b)).toBeNull()
    expect(segmentIntersection({ x: 1, y: -1 }, { x: 1, y: 1 }, a, b)).toBeNull()
  })

  it('extendSegment: 両端を延長する', () => {
    const [a, b] = extendSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)
    expect(a).toEqual({ x: -5, y: 0 })
    expect(b).toEqual({ x: 15, y: 0 })
  })
})
