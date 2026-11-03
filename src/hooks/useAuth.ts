import { useCallback, useEffect, useState } from 'react'
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface AuthState {
  loading: boolean
  userId: string | null
  name: string | null
  /** 起動時にユーザーが消されていて、ログイン情報を作り直した（前回のルームには戻らない） */
  reset: boolean
}

/** 登録した名前を端末にも保存しておく（サーバーからユーザーが消されたときに、自動で入り直すため） */
const NAME_KEY = 'gpx-track.name'
/** 入り直すときに消す、端末に残った古いデータ */
const STALE_KEYS = ['gpx-track.currentRoom', 'gpx-track.queue']

function readSavedName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY)
  } catch {
    return null
  }
}
function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* 保存できなくても動作は続ける */
  }
}
function clearStaleData(): void {
  try {
    for (const k of STALE_KEYS) localStorage.removeItem(k)
  } catch {
    /* noop */
  }
}

/**
 * ユーザーがサーバーにもういない（cleanup で消された）ことを示すエラーか。
 * 通信エラー（圏外など）は含めない（status 0 の AuthRetryableFetchError は AuthApiError ではない）
 */
function isUserGone(e: unknown): boolean {
  if (isAuthSessionMissingError(e)) return true
  if (!isAuthApiError(e)) return false
  return e.code === 'user_not_found' || e.code === 'session_not_found' || [401, 403, 404].includes(e.status)
}

async function fetchName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('name').eq('id', userId).maybeSingle()
  return (data?.name as string | undefined) ?? null
}

/** 新しく匿名サインインして名前を保存する */
async function signInWithName(name: string): Promise<string> {
  const r = await supabase.auth.signInAnonymously({ options: { data: { name } } })
  if (r.error) throw r.error
  const { error } = await supabase.rpc('update_profile_name', { p_name: name })
  if (error) throw error
  saveName(name)
  return r.data.session!.user.id
}

/** 端末に残ったログイン情報だけを消す（サーバーにユーザーがいなくても消せる） */
async function dropLocalSession(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
  clearStaleData()
}

/** 匿名サインインと名前（プロフィール） */
export function useAuth() {
  const [state, setState] = useState<AuthState>({ loading: true, userId: null, name: null, reset: false })

  useEffect(() => {
    let alive = true
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      let uid = data.session?.user.id ?? null
      let reset = false

      // 端末に残ったログイン情報のユーザーが、サーバーにまだいるかを確かめる
      if (uid) {
        const { error } = await supabase.auth.getUser()
        if (error && isUserGone(error)) {
          await dropLocalSession()
          uid = null
          reset = true
          // 保存した名前があれば、自動で入り直す（なければ名前登録の画面へ）
          const saved = readSavedName()
          if (saved) {
            try {
              uid = await signInWithName(saved)
            } catch {
              uid = null
            }
          }
        }
      }

      const name = uid ? await fetchName(uid) : null
      if (uid && name) saveName(name) // v1.1.0 以前に登録した端末にも名前を保存しておく
      if (alive) setState({ loading: false, userId: uid, name, reset })
    }
    void init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null
      setState((s) => (s.userId === uid ? s : { ...s, userId: uid, name: uid ? s.name : null }))
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /** 初回登録：必要なら匿名サインインしてから名前を保存 */
  const register = useCallback(async (name: string) => {
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      const uid = await signInWithName(name)
      setState((st) => ({ ...st, loading: false, userId: uid, name }))
      return
    }
    const { error } = await supabase.rpc('update_profile_name', { p_name: name })
    if (error) {
      // ユーザーが消されていて保存できなかった（外部キー違反 23503）ときは、入り直してもう1回だけ試す
      if (error.code !== '23503') throw error
      await dropLocalSession()
      const uid = await signInWithName(name)
      setState((st) => ({ ...st, loading: false, userId: uid, name }))
      return
    }
    saveName(name)
    setState((st) => ({ ...st, loading: false, userId: data.session!.user.id, name }))
  }, [])

  const rename = useCallback(async (name: string) => {
    const { error } = await supabase.rpc('update_profile_name', { p_name: name })
    if (error) throw error
    saveName(name)
    setState((s) => ({ ...s, name }))
  }, [])

  return { ...state, register, rename }
}
