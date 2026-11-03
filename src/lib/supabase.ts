import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

/** RPC などのエラーを画面表示用の日本語にする */
export function errorText(e: unknown): string {
  const msg =
    typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  const map: Record<string, string> = {
    invalid_passcode: 'パスコードが違います',
    room_not_found: '参加コードが見つかりません',
    not_owner: 'オーナーだけが操作できます',
    not_member: 'このルームのメンバーではありません',
    not_authenticated: 'ログインしていません',
    no_profile: '名前が登録されていません',
    invalid_name: '名前は1〜20文字で入力してください',
    invalid_status: '今のレース状態ではこの操作はできません',
    invalid_time: '時刻が正しくありません',
    duplicate_time: '同じ時刻の通過がすでにあります',
    not_found: '対象が見つかりません',
    duplicate_name: 'その名前はすでに名簿にあります',
    not_rider: '名簿にないライダーです',
  }
  for (const k of Object.keys(map)) if (msg.includes(k)) return map[k]
  if (/fetch|network/i.test(msg)) return '通信できませんでした'
  return msg
}
