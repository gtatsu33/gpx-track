import { useEffect, useState } from 'react'
import { buildCsv, buildShareText, csvFileName, type ExportInput } from '../lib/export'
import { errorText, supabase } from '../lib/supabase'
import type { LapRow, Rider, Room } from '../lib/types'
import { Modal } from './Modal'
import { useNotify } from './Notify'

interface Props {
  roomId: string
  onClose: () => void
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** iOS / iPadOS（iPadOS の Safari は Mac として名乗るのでタッチ対応で見分ける） */
function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

/**
 * CSV を保存する。Excel で文字化けしないよう BOM 付き UTF-8 にする。
 * iOS は共有メニューにファイルを渡す（「ファイルに保存」できる）。使えなければダウンロードにする
 */
async function saveCsv(text: string, name: string): Promise<'shared' | 'downloaded' | 'cancel'> {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  if (isIOS() && typeof navigator.canShare === 'function') {
    const file = new File([blob], name, { type: 'text/csv' })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
        return 'shared'
      } catch (e) {
        if (isAbort(e)) return 'cancel'
        // それ以外の失敗はダウンロードに切り替える
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  return 'downloaded'
}

/** 結果の出力（CSV の保存と、テキストでの共有） */
export function ExportMenu({ roomId, onClose }: Props) {
  const notify = useNotify()
  const [input, setInput] = useState<Omit<ExportInput, 'now'> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [manualText, setManualText] = useState<string | null>(null)

  // 開いたときに最新のデータを取る（共有はボタンを押した直後に呼ぶ必要があるため、先に取っておく）
  useEffect(() => {
    let alive = true
    void (async () => {
      const [roomRes, lapRes, riderRes] = await Promise.all([
        supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase.rpc('get_lap_table', { p_room: roomId }),
        supabase.from('riders').select('id, name, user_id').eq('room_id', roomId),
      ])
      if (!alive) return
      const err = roomRes.error ?? lapRes.error ?? riderRes.error
      if (err) return setLoadError(errorText(err))
      if (!roomRes.data) return setLoadError('ルームが見つからないか、メンバーではありません')
      setInput({ room: roomRes.data as Room, laps: (lapRes.data as LapRow[]) ?? [], riders: (riderRes.data as Rider[]) ?? [] })
    })()
    return () => {
      alive = false
    }
  }, [roomId])

  const onCsv = async () => {
    if (!input) return
    const now = Date.now()
    const r = await saveCsv(buildCsv({ ...input, now }), csvFileName(input.room, now))
    if (r === 'downloaded') notify('CSVを保存しました')
  }

  const onShare = async () => {
    if (!input) return
    const text = buildShareText({ ...input, now: Date.now() })
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text })
        return
      } catch (e) {
        if (isAbort(e)) return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      notify('結果をコピーしました')
    } catch {
      setManualText(text) // コピーもできなければ、手でコピーしてもらう
    }
  }

  if (manualText != null) {
    return (
      <Modal title="結果を共有" onClose={onClose}>
        <p className="hint">下の文章を長押しでコピーしてください。</p>
        <textarea className="export-text" readOnly value={manualText} onFocus={(e) => e.currentTarget.select()} />
      </Modal>
    )
  }

  const status = input?.room.status
  return (
    <Modal title="結果の出力" onClose={onClose}>
      {loadError && <p className="error-text">{loadError}</p>}
      {!input && !loadError && <p>読み込み中…</p>}
      {input && (
        <>
          <p>
            {input.room.team_name}
            {status === 'running' && '（レース中のため途中経過になります）'}
          </p>
          {status === 'ready' ? (
            <p className="hint">スタート前のため出力できません。</p>
          ) : (
            <>
              <button className="btn primary block" onClick={() => void onCsv()}>
                CSVを保存
              </button>
              <button className="btn block" onClick={() => void onShare()}>
                結果を共有
              </button>
            </>
          )}
        </>
      )}
      <p className="hint">cleanup で消えたレースは出力できません。残したいレースは先に出力してください。</p>
    </Modal>
  )
}
