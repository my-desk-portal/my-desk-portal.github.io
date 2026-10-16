"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { generateReactHelpers } from "@uploadthing/react";
import { db } from "@/lib/firebase";
import "./mydrive.css";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "/api/uploadthing";
const uploadThingConfigured = Boolean(process.env.NEXT_PUBLIC_UPLOADTHING_URL);
const myDriveMaxFiles = 30;
const myDriveMaxBytes = 30 * 1024 * 1024;
const { useUploadThing } = generateReactHelpers<any>({ url: uploadThingUrl });

type MyDriveFile = {
  id: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  fileURL: string;
  fileKey: string;
  uploadedAt?: unknown;
};

function displayBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function displayFileDate(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value
      : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Recently uploaded";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function fileIcon(name: string, mimeType: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf" || mimeType === "application/pdf") return { label: "PDF", kind: "pdf" };
  if (["xls", "xlsx", "csv", "ods"].includes(extension) || mimeType.includes("spreadsheet")) return { label: "XLS", kind: "sheet" };
  if (["doc", "docx", "odt", "rtf"].includes(extension) || mimeType.includes("wordprocessing")) return { label: "DOC", kind: "document" };
  if (["ppt", "pptx", "odp"].includes(extension) || mimeType.includes("presentation")) return { label: "PPT", kind: "slides" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return { label: "ZIP", kind: "archive" };
  if (mimeType.startsWith("image/")) return { label: "IMG", kind: "image" };
  if (mimeType.startsWith("audio/")) return { label: "AUD", kind: "audio" };
  if (mimeType.startsWith("video/")) return { label: "VID", kind: "video" };
  const shortExtension = extension.replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase();
  return { label: shortExtension || "FILE", kind: "generic" };
}

function renameEndpoint() {
  return uploadThingUrl.replace(/\/api\/uploadthing\/?$/, "/api/rename-my-drive-file");
}

export default function MyDrive({ user }: { user: User }) {
  const [files, setFiles] = useState<MyDriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editingFile, setEditingFile] = useState<MyDriveFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [sortAscending, setSortAscending] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadErrorRef = useRef("");
  const { startUpload } = useUploadThing("myDriveFile", {
    headers: async () => ({ Authorization: `Bearer ${await user.getIdToken(true)}` }),
    onUploadError: (uploadError) => {
      uploadErrorRef.current = uploadError.message || "Could not upload your files. Try again.";
      setError(uploadErrorRef.current);
    },
  });

  useEffect(() => {
    if (!db) {
      setError("File storage is unavailable. Sign in again and retry.");
      setLoading(false);
      return;
    }
    return onSnapshot(query(collection(db, "myDriveFiles"), where("ownerId", "==", user.uid)), (snapshot) => {
      setFiles(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as MyDriveFile)));
      setLoading(false);
    }, () => {
      setError("Could not load your myDrive files. Refresh the page and try again.");
      setLoading(false);
    });
  }, [user.uid]);

  const sortedFiles = useMemo(() => [...files].sort((left, right) => {
    const order = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return sortAscending ? order : -order;
  }), [files, sortAscending]);
  const usedBytes = files.reduce((total, file) => total + (Number.isFinite(file.size) ? file.size : 0), 0);
  const canUpload = files.length < myDriveMaxFiles && usedBytes < myDriveMaxBytes;

  async function uploadSelection(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selected.length === 0) return;
    setError("");
    setMessage("");

    if (!uploadThingConfigured) {
      setError("myDrive uploads are not configured yet.");
      return;
    }
    if (!canUpload) {
      setError("Your myDrive is at its 30-file or 30 MB limit.");
      return;
    }
    if (files.length + selected.length > myDriveMaxFiles) {
      setError(`Choose no more than ${myDriveMaxFiles - files.length} additional file${myDriveMaxFiles - files.length === 1 ? "" : "s"}.`);
      return;
    }
    const selectedBytes = selected.reduce((total, file) => total + file.size, 0);
    if (usedBytes + selectedBytes > myDriveMaxBytes) {
      setError(`These files exceed the remaining ${displayBytes(myDriveMaxBytes - usedBytes)} of storage.`);
      return;
    }
    if (selected.some((file) => file.size > myDriveMaxBytes)) {
      setError("Each file must be 30 MB or smaller.");
      return;
    }

    setUploading(true);
    let uploadedCount = 0;
    try {
      for (const file of selected) {
        uploadErrorRef.current = "";
        const result = await startUpload([file]);
        if (!result?.length) {
          throw new Error(uploadErrorRef.current || "UploadThing did not confirm that this file finished uploading.");
        }
        uploadedCount += 1;
      }
      if (uploadedCount > 0) setMessage(`${uploadedCount} file${uploadedCount === 1 ? "" : "s"} uploaded successfully.`);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The selected files could not all be uploaded.";
      setError(uploadedCount ? `${uploadedCount} uploaded; the next file failed: ${reason}` : reason);
    } finally {
      setUploading(false);
    }
  }

  function beginRename(file: MyDriveFile) {
    setError("");
    setMessage("");
    setEditingFile(file);
    setRenameValue(file.name);
  }

  function cancelRename() {
    if (renaming) return;
    setEditingFile(null);
    setRenameValue("");
  }

  async function saveRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFile || renaming) return;
    const name = renameValue.trim();
    if (!name) {
      setError("Enter a name for this file.");
      return;
    }
    if (name.length > 160 || /[\\/\u0000-\u001f]/.test(name)) {
      setError("File names must be 160 characters or fewer and cannot include slashes.");
      return;
    }
    if (name === editingFile.name) {
      cancelRename();
      return;
    }

    setError("");
    setMessage("");
    setRenaming(true);
    try {
      const response = await fetch(renameEndpoint(), {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken(true)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: editingFile.id, fileKey: editingFile.fileKey, newName: name }),
      });
      if (!response.ok) {
        const reason = await response.text().catch(() => "");
        throw new Error(reason || "Could not rename this file.");
      }
      setMessage(`Renamed to ${name}.`);
      setEditingFile(null);
      setRenameValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename this file.");
    } finally {
      setRenaming(false);
    }
  }

  return <section className="mydrive-section content-section" aria-labelledby="mydrive-title">
    <div className="section-heading mydrive-heading">
      <div><p className="eyebrow">Your files</p><h2 id="mydrive-title">myDrive</h2><p className="muted">Store your files in one place. Each account can keep up to 30 files and 30 MB in total.</p></div>
      <button type="button" className={`primary-button mydrive-upload-button${uploading ? " is-busy" : ""}`} onClick={() => fileInputRef.current?.click()} disabled={loading || uploading || !canUpload}>
        {uploading ? "Uploading..." : "Upload files"}
      </button>
      <input ref={fileInputRef} className="mydrive-file-input" type="file" multiple aria-label="Upload files to myDrive" onChange={(event) => void uploadSelection(event)} disabled={uploading || !canUpload} />
    </div>

    <div className="mydrive-usage" aria-label="myDrive storage used">
      <span><strong>{files.length}</strong> / {myDriveMaxFiles} files</span>
      <span><strong>{displayBytes(usedBytes)}</strong> / {displayBytes(myDriveMaxBytes)}</span>
      <div className="mydrive-usage-bar" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={myDriveMaxBytes} aria-valuenow={Math.min(usedBytes, myDriveMaxBytes)}><span style={{ width: `${Math.min(100, usedBytes / myDriveMaxBytes * 100)}%` }} /></div>
    </div>

    {error && <p className="mydrive-message is-error" role="alert">{error}</p>}
    {message && <p className="mydrive-message is-success" role="status">{message}</p>}

    <div className="mydrive-list" aria-label="Your files">
      <div className="mydrive-list-heading">
        <span aria-hidden="true" />
        <button type="button" className="mydrive-sort-button" onClick={() => setSortAscending((ascending) => !ascending)} aria-label={`Sort by name ${sortAscending ? "descending" : "ascending"}`} aria-pressed={!sortAscending}>
          Name <span aria-hidden="true">{sortAscending ? <>&uarr;</> : <>&darr;</>}</span>
        </button>
        <span className="mydrive-date-heading">Date added</span>
        <span className="mydrive-size-heading">Size</span>
        <span className="mydrive-actions-heading">Actions</span>
      </div>
      {loading ? <div className="mydrive-empty-state">Loading your files...</div>
        : sortedFiles.length === 0 ? <div className="mydrive-empty-state"><strong>No files yet</strong><span>Upload a file to see it here.</span></div>
          : sortedFiles.map((file) => {
            const icon = fileIcon(file.name, file.mimeType ?? "");
            return <div className={`mydrive-file-row${editingFile?.id === file.id ? " is-editing" : ""}`} key={file.id}>
              <div className={`mydrive-file-icon is-${icon.kind}`} aria-hidden="true">{icon.label}</div>
              <div className="mydrive-file-details">
                {editingFile?.id === file.id ? <form className="mydrive-rename-form" onSubmit={(event) => void saveRename(event)}>
                  <label className="mydrive-rename-label" htmlFor={`mydrive-rename-${file.id}`}>Rename file</label>
                  <input id={`mydrive-rename-${file.id}`} autoFocus maxLength={160} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") cancelRename(); }} disabled={renaming} />
                  <button className="mydrive-inline-action is-save" type="submit" disabled={renaming}>{renaming ? "Saving..." : "Save"}</button>
                  <button className="mydrive-inline-action" type="button" onClick={cancelRename} disabled={renaming}>Cancel</button>
                </form> : <><strong className="mydrive-file-name" title={file.name}>{file.name}</strong><span className="mydrive-mobile-meta">{displayFileDate(file.uploadedAt)} &middot; {displayBytes(file.size)}</span></>}
              </div>
              <span className="mydrive-file-date">{displayFileDate(file.uploadedAt)}</span>
              <span className="mydrive-file-size">{displayBytes(file.size)}</span>
              {editingFile?.id !== file.id && <div className="mydrive-file-actions">
                <button type="button" className="mydrive-inline-action" onClick={() => beginRename(file)}>Rename</button>
                <a className="mydrive-inline-action is-download" href={file.fileURL} download={file.name}>Download</a>
              </div>}
            </div>;
          })}
    </div>
  </section>;
}
