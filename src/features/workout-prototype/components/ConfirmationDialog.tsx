"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 위험한 작업(리셋)은 Danger 스타일 */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 중요 작업 확인창. 네이티브 <dialog>의 showModal()을 사용해
 * 포커스 가두기와 Esc 닫기를 브라우저에 맡긴다. 확인 전에는 데이터를 바꾸지 않는다.
 */
export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "취소",
  tone = "primary",
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const confirmClass =
    tone === "danger"
      ? "bg-danger text-app hover:brightness-110"
      : "bg-accent text-on-accent hover:brightness-110";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirmation-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-sm rounded-2xl border border-line bg-elevated p-0 text-fg backdrop:bg-black/70"
    >
      <div className="p-5">
        <h2 id="confirmation-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-fg-secondary">{children}</div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl border border-line px-4 text-sm font-medium text-fg hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-12 flex-1 rounded-xl px-4 text-sm font-semibold ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
