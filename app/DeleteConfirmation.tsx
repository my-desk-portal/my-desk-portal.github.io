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
      <div className="delete-confirmation-icon" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M22 23h20l-1.8 27H23.8L22 23Z" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" /><path d="M18 18h28M27 18v-5h10v5M28 28v15M36 28v15" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /><path d="M13 12v6M10 15h6M51 11v6M48 14h6M50 49v5M47.5 51.5h5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></div>
      <h2 id="delete-confirmation-title">{title}</h2>
      <p id="delete-confirmation-description">{description}</p>
      <div className="delete-confirmation-actions">
        <button type="button" className="delete-confirmation-cancel" ref={cancelButtonRef} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="delete-confirmation-confirm" ref={deleteButtonRef} disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Delete"}</button>
      </div>
    </section>
  </div>;
}
