// 時刻・タイムの書式

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 端末ローカル時刻の HH:MM:SS */
export function formatClock(d: Date | string | number): string {
  const x = new Date(d)
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}:${pad2(x.getSeconds())}`
}

/** 端末ローカル時刻の HH:MM */
export function formatHM(d: Date | string | number): string {
  const x = new Date(d)
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`
}

/** ラップタイム：1時間未満は m:ss.s、1時間以上は h:mm:ss.s */
export function formatLap(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--'
  const tenths = Math.round(ms / 100)
  const h = Math.floor(tenths / 36000)
  const m = Math.floor((tenths % 36000) / 600)
  const s = Math.floor((tenths % 600) / 10)
  const t = tenths % 10
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}.${t}`
  return `${m}:${pad2(s)}.${t}`
}

/** 経過・残り時間：h:mm:ss */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${pad2(m)}:${pad2(s)}`
}

/** <input type="datetime-local" step="1"> 用のローカル時刻文字列 */
export function toDatetimeLocal(d: Date | string | number): string {
  const x = new Date(d)
  return (
    `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}` +
    `T${pad2(x.getHours())}:${pad2(x.getMinutes())}:${pad2(x.getSeconds())}`
  )
}
