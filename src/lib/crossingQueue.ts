// 送信できなかった通過・走行距離を localStorage に保存して再送する
import { supabase } from './supabase'

export type QueueJob =
  | { kind: 'crossing'; room: string; t: number; rider?: string | null }
  | { kind: 'segment'; room: string; user: string; rider?: string | null; from: number; to: number; meters: number }

const KEY = 'gpx-track.queue'
const MAX_JOBS = 1000
const MAX_AGE_MS = 12 * 3600 * 1000

function load(): QueueJob[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as QueueJob[]) : []
  } catch {
    return []
  }
}

function save(jobs: QueueJob[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs.slice(-MAX_JOBS)))
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

export function enqueue(job: QueueJob): void {
  save([...load(), job])
}

export type SendResult = 'ok' | 'retry' | 'drop'

/** 1件送信。通信エラー・サーバーエラーは retry、それ以外の拒否は drop */
export async function sendJob(job: QueueJob): Promise<SendResult> {
  try {
    if (job.kind === 'crossing') {
      const { error, status } = await supabase.rpc('record_crossing', {
        p_room: job.room,
        p_crossed_at: new Date(job.t).toISOString(),
        p_rider: job.rider ?? null,
      })
      if (!error) return 'ok'
      return status === 0 || status >= 500 ? 'retry' : 'drop'
    }
    const { error, status } = await supabase.from('distance_segments').insert({
      room_id: job.room,
      user_id: job.user,
      rider_id: job.rider ?? null,
      t_from: new Date(job.from).toISOString(),
      t_to: new Date(job.to).toISOString(),
      meters: job.meters,
    })
    if (!error) return 'ok'
    return status === 0 || status >= 500 ? 'retry' : 'drop'
  } catch {
    return 'retry'
  }
}

/** 送信してだめなら保存（呼び出し側は待たなくてよい） */
export async function sendOrQueue(job: QueueJob): Promise<SendResult> {
  const r = await sendJob(job)
  if (r === 'retry') enqueue(job)
  return r
}

let flushing = false

/** 保存済みの再送。古すぎるものは捨てる */
export async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const now = Date.now()
    const all = load()
    const jobs = all.filter((j) => now - (j.kind === 'crossing' ? j.t : j.to) < MAX_AGE_MS)
    const keep: QueueJob[] = []
    for (const j of jobs) {
      const r = await sendJob(j)
      if (r === 'retry') keep.push(j)
    }
    // 送信中に追加された分を失わないよう、送信前に読んだ分だけ入れ替える
    const added = load().slice(all.length)
    save([...keep, ...added])
  } finally {
    flushing = false
  }
}
