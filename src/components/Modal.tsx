import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** アプリ内モーダル（alert / confirm の代わり） */
export function Modal({ title, onClose, children, footer }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  message: string
  okLabel?: string
  danger?: boolean
  onOk: () => void
  onCancel: () => void
}

export function ConfirmModal({ title, message, okLabel = 'OK', danger, onOk, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            キャンセル
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onOk}>
            {okLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}
