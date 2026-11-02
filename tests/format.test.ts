import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, formatLap, toDatetimeLocal } from '../src/lib/format'

describe('format', () => {
  it('formatLap', () => {
    expect(formatLap(151400)).toBe('2:31.4')
    expect(formatLap(9960)).toBe('0:10.0')
    expect(formatLap(59999)).toBe('1:00.0')
    expect(formatLap(3723400)).toBe('1:02:03.4')
    expect(formatLap(null)).toBe('--')
    expect(formatLap(-1)).toBe('--')
  })

  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00:00')
    expect(formatDuration(11565000)).toBe('3:12:45')
    expect(formatDuration(-5)).toBe('0:00:00')
  })

  it('formatClock / toDatetimeLocal（ローカル時刻）', () => {
    const d = new Date(2026, 10, 2, 14, 5, 9)
    expect(formatClock(d)).toBe('14:05:09')
    expect(toDatetimeLocal(d)).toBe('2026-11-02T14:05:09')
  })
})
