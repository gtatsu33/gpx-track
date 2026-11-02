// 動作パラメータ（implement.txt ■9）

/** 走行中の位置送信間隔。測位・通過判定・距離計算は端末内で約1秒ごとに行う */
export const POS_INTERVAL_MOVING_MS = 5000
/** ピットにいるときの位置送信間隔 */
export const POS_INTERVAL_PIT_MS = 10000
/** これより精度が悪い測位は使わない */
export const MAX_ACCURACY_M = 30
/** コントロールラインを両端で延長する距離 */
export const LINE_EXTEND_M = 15
/** 2点の間隔がこれを超えたら通過判定・距離加算をしない */
export const MAX_GAP_SEC = 20
/** 判定速度以上がこの秒数続いたら「走行中」 */
export const MOVING_ON_SEC = 10
/** 判定速度未満がこの秒数続いたら「ピット」 */
export const MOVING_OFF_SEC = 30
/** 走行距離をまとめてサーバーへ送る間隔 */
export const DISTANCE_FLUSH_SEC = 10
/** これ以上位置が更新されないメンバーはグレー表示 */
export const STALE_MARKER_SEC = 30
/** 現在のライダーの軌跡を表示する長さ */
export const TRAIL_SEC = 60
/** 通過からこの秒数の間はラップの名前を暫定表示 */
export const LAP_PROVISIONAL_SEC = 15
/** 定型ボタンの連打防止 */
export const QUICK_BUTTON_COOLDOWN_MS = 2000
/** チャットの表示件数 */
export const CHAT_LIMIT = 50
/** 送信できなかったデータの再送間隔 */
export const QUEUE_RETRY_MS = 15000

export const QUICK_MESSAGES = ['もう一周いく', 'ピットインする'] as const

/** メンバーの色（color_idx % 10） */
export const MEMBER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#0ea5a5', '#d61fb4', '#7a8b00', '#9a6324', '#1f2937',
]
