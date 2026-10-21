"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as faceapi from "face-api.js";
import { useAuth } from "@/components/auth/auth-provider";

const MODEL_URL = "/models";
const DETECTION_INTERVAL_MS = 400;

export function FaceCameraCheck() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const verifyingRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function stopCamera() {
    activeRef.current = false;
    verifyingRef.current = false;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (mountedRef.current) setRunning(false);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCamera() {
    setError("");
    setStarting(true);
    setStatus("Loading face-recognition models…");

    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      if (!mountedRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview is unavailable.");

      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current) return;

      activeRef.current = true;
      setRunning(true);
      setStatus("Camera ready. Looking for a face…");

      const detectFace = async () => {
        if (!activeRef.current || !videoRef.current) return;

        try {
          const currentVideo = videoRef.current;
          const detection = await faceapi
            .detectSingleFace(
            currentVideo,
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }),
            )
            .withFaceLandmarks()
            .withFaceDescriptor();
          if (!activeRef.current) return;

          const canvas = canvasRef.current;
          if (canvas && currentVideo.videoWidth > 0 && currentVideo.videoHeight > 0) {
            const displaySize = {
              width: currentVideo.clientWidth,
              height: currentVideo.clientHeight,
            };
            if (displaySize.width > 0 && displaySize.height > 0) {
              faceapi.matchDimensions(canvas, displaySize);
              const context = canvas.getContext("2d");
              context?.clearRect(0, 0, canvas.width, canvas.height);
              if (detection) {
                const resizedDetection = faceapi.resizeResults(detection, displaySize);
                faceapi.draw.drawDetections(canvas, resizedDetection);
              }
            }
          }

          if (!detection) {
            setStatus("No face detected. Position your face in the frame.");
          } else if (!verifyingRef.current) {
            verifyingRef.current = true;
            setStatus("Face detected. Verifying with the server…");
            const response = await fetch("/api/auth/face-login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ descriptor: Array.from(detection.descriptor) }),
            });
            const result = (await response.json()) as {
              success?: boolean;
              role?: string;
              redirectUrl?: string;
              message?: string;
              error?: { message?: string };
            };
            if (!activeRef.current) return;
            if (
              !response.ok ||
              !result.success ||
              !["admin", "patient"].includes(result.role ?? "") ||
              !["/admin", "/patient/book"].includes(result.redirectUrl ?? "")
            ) {
              stopCamera();
              setError(result.message ?? result.error?.message ?? "Face was not recognized.");
            } else {
              const destination = result.role === "admin" ? "/admin" : "/patient/book";
              const user = await refreshSession();
              if (user.role !== result.role) {
                throw new Error("The authenticated account role did not match the verification result.");
              }
              stopCamera();
              router.push(destination);
              router.refresh();
              return;
            }
          }
          timeoutRef.current = window.setTimeout(detectFace, DETECTION_INTERVAL_MS);
        } catch (cause) {
          if (!activeRef.current) return;
          stopCamera();
          setError(
            cause instanceof Error
              ? `Face detection failed: ${cause.message}`
              : "Face detection failed. Please try again.",
          );
        }
      };

      void detectFace();
    } catch (cause) {
      stopCamera();
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start the camera check. Please try again.",
      );
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }

  return (
    <section className="mt-6 border-t border-divider pt-5" aria-labelledby="face-check-title">
      <h2 id="face-check-title" className="text-[14px] font-semibold text-heading">
        Optional face camera check
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Face login requires an enrolled descriptor and server verification. The camera image and
        descriptor are sent to the server for comparison; face matching does not establish liveness.
      </p>

      {running || starting ? (
        <div className="relative mt-3 w-full overflow-hidden rounded-btn bg-slate-950">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label="Live camera preview for face detection"
            className="block h-auto w-full"
          />
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        </div>
      ) : null}

      {status ? (
        <p aria-live="polite" className="mt-2 text-[12px] text-muted">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] font-medium text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={starting}
        onClick={running ? stopCamera : startCamera}
        className="mt-3 w-full rounded-btn border border-divider px-4 py-2.5 text-[13px] font-semibold text-heading hover:bg-page disabled:cursor-wait disabled:opacity-60"
      >
        {starting ? "Starting camera…" : running ? "Stop camera" : "Start face camera check"}
      </button>
    </section>
  );
}
