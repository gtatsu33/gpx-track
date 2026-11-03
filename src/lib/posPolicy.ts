// 位置を送るかどうかの判断（純粋関数。spec.txt ■4）

export interface PosSendState {
  /** 最後に送った時刻（ms）。まだ送っていなければ null */
  lastSentAt: number | null
  /** 最後に送った位置が「走行中」だったか。まだ送っていなければ null */
  lastSentMoving: boolean | null
}

/**
 * 走行中：送信間隔ごとに送る（団体戦5秒、個人戦10秒）。
 * ピット：送らない。ただし、走行中からピットになったときと、まだ1回も送っていないときは1回だけ送る
 * （地図に最後の位置を残すため）
 */
export function shouldSendPos(state: PosSendState, moving: boolean, now: number, movingIntervalMs: number): boolean {
  if (state.lastSentAt == null) return true
  if (moving) return now - state.lastSentAt >= movingIntervalMs
  return state.lastSentMoving === true
}
