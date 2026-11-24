'use client';
// ダイアログ（共通部品）。開くとフォーカスが中へ移り、Tab は中で循環し（外に出ていても Tab で中へ戻る）、Esc で閉じ、
// 閉じると開く前の場所へフォーカスが戻る。背景を押しても閉じない（横断仕様・画面受入条件 B24）
//
// props：
//   open：開いているか
//   title：題（aria-labelledby に使う）
//   children：本文
//   actions?：下に並べるボタン
//   onClose：Esc で閉じるときに呼ぶ
//   closeOnEsc?：false にすると Esc でも閉じない（処理中など。既定 true）
//   initialFocusRef?：開いたときにフォーカスを置く要素（無ければ最初に押せる要素）
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeOnEsc?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function Dialog({ open, title, children, actions, onClose, closeOnEsc = true, initialFocusRef }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscRef = useRef(closeOnEsc);
  onCloseRef.current = onClose;
  closeOnEscRef.current = closeOnEsc;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    first?.focus();

    function focusables(): HTMLElement[] {
      return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (closeOnEscRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && panel !== null && panel.contains(active);
      const index = inside ? items.indexOf(active as HTMLElement) : -1;
      event.preventDefault();
      if (event.shiftKey) {
        items[index <= 0 ? items.length - 1 : index - 1].focus();
      } else {
        items[index < 0 || index >= items.length - 1 ? 0 : index + 1].focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    };
    // 開いたときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-app rounded-2xl bg-white p-5 shadow-xl outline-none"
      >
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        {children && <div className="mt-3">{children}</div>}
        {actions && <div className="mt-5 flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
