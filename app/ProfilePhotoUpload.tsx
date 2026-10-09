"use client";

import { useState, type ChangeEvent } from "react";
import type { User } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { generateReactHelpers } from "@uploadthing/react";
import { db } from "@/lib/firebase";
import "./profile-photo.css";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "/api/uploadthing";
const uploadThingConfigured = Boolean(process.env.NEXT_PUBLIC_UPLOADTHING_URL);

const { useUploadThing } = generateReactHelpers<any>({ url: uploadThingUrl });
const maxPhotoBytes = 4 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function ProfilePhotoUpload({
  user,
  photoURL,
  disabled = false,
  onUploaded,
}: {
  user: User;
  photoURL: string;
  disabled?: boolean;
  onUploaded: (url: string) => void;
}) {
  const [error, setError] = useState("");
  const { startUpload, isUploading } = useUploadThing("profilePhoto", {
    headers: async () => ({ Authorization: `Bearer ${await user.getIdToken(true)}` }),
    onUploadError: (uploadError) => setError(uploadError.message || "Could not upload the profile photo. Try again."),
  });

  async function handleSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    if (!acceptedImageTypes.has(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > maxPhotoBytes) {
      setError("Profile photos must be 4 MB or smaller.");
      return;
    }
    if (!uploadThingConfigured) {
      setError("Profile photo uploads are not configured yet.");
      return;
    }

    setError("");
    try {
      const uploadedFiles = await startUpload([file]);
      const uploaded = uploadedFiles?.[0] as { key?: string; ufsUrl?: string; url?: string; serverData?: { photoURL?: string } } | undefined;
      const appId = process.env.NEXT_PUBLIC_UPLOADTHING_APP_ID;
      const keyURL = uploaded?.key && appId ? `https://${appId}.ufs.sh/f/${uploaded.key}` : undefined;
      const uploadedURL = uploaded?.serverData?.photoURL ?? uploaded?.ufsUrl ?? uploaded?.url ?? keyURL;
      if (!uploadedURL) {
        if (!uploadedFiles) return;
        throw new Error("The photo uploaded, but its profile link was not returned.");
      }
      if (!db) throw new Error("Your profile could not be updated. Sign in again and retry.");
      await updateDoc(doc(db, "users", user.uid), { photoURL: uploadedURL });
      onUploaded(uploadedURL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload the profile photo. Try again.");
    }
  }

  return (
    <div className="profile-photo-field">
      {photoURL
        ? <img className="profile-photo-preview" src={photoURL} alt="Current profile photo" />
        : <span className="profile-photo-preview profile-photo-placeholder" aria-hidden="true">{user.displayName?.trim().charAt(0).toUpperCase() || "?"}</span>}
      <div className="profile-photo-controls">
        <strong>Profile photo</strong>
        <label className="profile-photo-select">
          <span className="ghost-button">{isUploading ? "Uploading..." : photoURL ? "Change photo" : "Choose photo"}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" onChange={(event) => void handleSelection(event)} disabled={disabled || isUploading} />
        </label>
        <small>JPEG, PNG, or WebP. Maximum 4 MB.</small>
        {error && <span className="auth-message auth-message-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
