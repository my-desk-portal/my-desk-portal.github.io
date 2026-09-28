"use client";

import { useEffect, useRef } from "react";

export default function SystemBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.controls = false;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.removeAttribute("controls");

    const startPlayback = () => {
      if (!video.paused) return;
      void video.play().catch(() => {
        // Autoplay can be delayed by the browser; retry when the video or page is ready.
      });
    };

    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") startPlayback();
    };

    startPlayback();
    video.addEventListener("loadeddata", startPlayback);
    video.addEventListener("canplay", startPlayback);
    video.addEventListener("pause", retryWhenVisible);
    window.addEventListener("pageshow", startPlayback);
    document.addEventListener("visibilitychange", retryWhenVisible);

    return () => {
      video.removeEventListener("loadeddata", startPlayback);
      video.removeEventListener("canplay", startPlayback);
      video.removeEventListener("pause", retryWhenVisible);
      window.removeEventListener("pageshow", startPlayback);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, []);

  return (
    <div className="system-background" aria-hidden="true">
      <video
        ref={videoRef}
        className="system-background-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        draggable={false}
        tabIndex={-1}
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/bg.mp4`}
      />
    </div>
  );
}
