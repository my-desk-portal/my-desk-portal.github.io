"use client";

import { useEffect, useRef } from "react";
import "./delete-confirmation.css";

export default function DeleteConfirmation({ open, title, description, busy = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
      }
      if (event.key !== "Tab") return;
      const cancelButton = cancelButtonRef.current;
      const deleteButton = deleteButtonRef.current;
      if (!cancelButton || !deleteButton) return;
      if (busyRef.current) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (event.shiftKey && (document.activeElement === cancelButton || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        deleteButton.focus();
      } else if (!event.shiftKey && (document.activeElement === deleteButton || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        cancelButton.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return <div className="delete-confirmation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section ref={dialogRef} className="delete-confirmation-dialog" role="alertdialog" aria-modal="true" aria-busy={busy} aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description" tabIndex={-1}>
      <h2 id="delete-confirmation-title">{title}</h2>
      <p id="delete-confirmation-description">{description}</p>
      <div className="delete-confirmation-actions">
        <button type="button" className="delete-confirmation-cancel" ref={cancelButtonRef} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="delete-confirmation-confirm" ref={deleteButtonRef} disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Delete"}</button>
      </div>
    </section>
  </div>;
}
