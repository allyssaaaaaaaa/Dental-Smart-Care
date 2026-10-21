"use client";

import { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";

const MODEL_URL = "/models";

type ApiError = {
  error?: { message?: string };
  message?: string;
};

async function readResponse(response: Response) {
  const data = (await response.json()) as ApiError & { success?: boolean };
  if (!response.ok) {
    throw new Error(data.error?.message ?? data.message ?? "Face login settings could not be updated.");
  }
  return data;
}

export function FaceEnrollment() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [open, setOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCamera() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      setCameraReady(true);
    } catch (cause) {
      stopCamera();
      setError(cause instanceof Error ? cause.message : "Could not start the camera.");
    } finally {
      setBusy(false);
    }
  }

  async function enrollFace() {
    const video = videoRef.current;
    if (!consent || !cameraReady || !video) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) throw new Error("No face detected. Center your face and try again.");

      const response = await fetch("/api/auth/face-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          descriptor: Array.from(detection.descriptor),
        }),
      });
      await readResponse(response);
      setMessage("Face login is enabled for this account.");
      stopCamera();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not enroll this face.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFace() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/face-enroll", { method: "DELETE" });
      await readResponse(response);
      setMessage("Enrolled face descriptor removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove face login.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-3 mb-3 rounded-[10px] border border-divider bg-white p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setError("");
          setMessage("");
        }}
        className="w-full text-left text-[13px] font-semibold text-heading"
      >
        {open ? "Hide face login settings" : "Set up face login"}
      </button>
      {open ? (
        <div className="mt-2">
          <p className="text-[11px] leading-relaxed text-muted">
            Your face descriptor is stored encrypted and can be removed here. Face matching does
            not prove liveness; keep password sign-in available.
          </p>
          <label className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-heading">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5"
            />
            I consent to enrolling and storing my face descriptor for sign-in.
          </label>
          {cameraReady ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Face enrollment camera preview"
              className="mt-3 aspect-video w-full rounded-btn bg-slate-950 object-cover"
            />
          ) : (
            <video ref={videoRef} className="hidden" muted playsInline />
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || cameraReady}
              onClick={() => void startCamera()}
              className="rounded-btn border border-divider px-3 py-2 text-[11px] font-semibold text-heading disabled:opacity-60"
            >
              {busy && !cameraReady ? "Preparing…" : "Start camera"}
            </button>
            <button
              type="button"
              disabled={busy || !cameraReady || !consent}
              onClick={() => void enrollFace()}
              className="rounded-btn bg-primary px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
            >
              {busy && cameraReady ? "Saving…" : "Enroll face"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeFace()}
              className="rounded-btn border border-divider px-3 py-2 text-[11px] font-semibold text-heading disabled:opacity-60"
            >
              Remove enrollment
            </button>
            {cameraReady ? (
              <button
                type="button"
                disabled={busy}
                onClick={stopCamera}
                className="rounded-btn border border-divider px-3 py-2 text-[11px] font-semibold text-heading"
              >
                Stop camera
              </button>
            ) : null}
          </div>
          {message ? <p aria-live="polite" className="mt-2 text-[11px] text-primary">{message}</p> : null}
          {error ? <p role="alert" className="mt-2 text-[11px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
