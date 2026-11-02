import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface AuthState {
  loading: boolean
  userId: string | null
  name: string | null
}

async function fetchName(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('name').eq('id', userId).maybeSingle()
  return (data?.name as string | undefined) ?? null
}

/** 匿名サインインと名前（プロフィール） */
export function useAuth() {
  const [state, setState] = useState<AuthState>({ loading: true, userId: null, name: null })

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null
      const name = uid ? await fetchName(uid) : null
      if (alive) setState({ loading: false, userId: uid, name })
    })
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
    let { data } = await supabase.auth.getSession()
    if (!data.session) {
      const r = await supabase.auth.signInAnonymously({ options: { data: { name } } })
      if (r.error) throw r.error
      data = { session: r.data.session! }
    }
    const { error } = await supabase.rpc('update_profile_name', { p_name: name })
    if (error) throw error
    setState({ loading: false, userId: data.session!.user.id, name })
  }, [])

  const rename = useCallback(async (name: string) => {
    const { error } = await supabase.rpc('update_profile_name', { p_name: name })
    if (error) throw error
    setState((s) => ({ ...s, name }))
  }, [])

  return { ...state, register, rename }
}
