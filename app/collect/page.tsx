"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

type Label = "shadow_clone" | "none";

type CropBox = {
  x: number;
  y: number;
  size: number;
};

export default function CollectPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cropRef = useRef<CropBox | null>(null);
  const animationFrameRef = useRef<number | null>(
    null
  );
  const lastVideoTimeRef = useRef(-1);

  const [label, setLabel] =
    useState<Label>("shadow_clone");

  const [handCount, setHandCount] = useState(0);

  const [status, setStatus] =
    useState("INITIALIZING...");

  const [isSaving, setIsSaving] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [sessionProgress, setSessionProgress] = useState(0);

  const [counts, setCounts] = useState({
    shadow_clone: 0,
    none: 0,
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function initialize() {
      try {
        setStatus("LOADING HAND TRACKER...");

        const vision =
          await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );

        const handLandmarker =
          await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              },

              runningMode: "VIDEO",
              numHands: 2,

              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            }
          );

        if (cancelled) return;

        setStatus("REQUESTING CAMERA...");

        stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              width: 1280,
              height: 720,
              facingMode: "user",
            },
            audio: false,
          });

        const video = videoRef.current;

        if (!video) return;

        video.srcObject = stream;

        await video.play();

        setStatus("READY TO COLLECT");

        function render() {
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (!video || !canvas) return;

          if (
            video.readyState >= 2 &&
            video.currentTime !==
              lastVideoTimeRef.current
          ) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext("2d");

            if (!ctx) return;

            ctx.clearRect(
              0,
              0,
              canvas.width,
              canvas.height
            );

            const result =
              handLandmarker.detectForVideo(
                video,
                performance.now()
              );

            setHandCount(result.landmarks.length);

            const allLandmarks =
              result.landmarks.flat();

            if (allLandmarks.length > 0) {
              const xs = allLandmarks.map(
                (point) =>
                  point.x * canvas.width
              );

              const ys = allLandmarks.map(
                (point) =>
                  point.y * canvas.height
              );

              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);

              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);

              const handWidth = maxX - minX;
              const handHeight = maxY - minY;

              const centerX =
                (minX + maxX) / 2;

              const centerY =
                (minY + maxY) / 2;

              /*
               * 손이 겹쳤을 때 MediaPipe가
               * 한 손만 잡는 경우가 있으므로
               * bounding box보다 훨씬 넉넉하게 자른다.
               */
              const baseSize = Math.max(
                handWidth,
                handHeight
              );

              let cropSize = Math.max(
                baseSize * 2.4,
                300
              );

              cropSize = Math.min(
                cropSize,
                canvas.width,
                canvas.height
              );

              let cropX =
                centerX - cropSize / 2;

              let cropY =
                centerY - cropSize / 2;

              cropX = Math.max(
                0,
                Math.min(
                  cropX,
                  canvas.width - cropSize
                )
              );

              cropY = Math.max(
                0,
                Math.min(
                  cropY,
                  canvas.height - cropSize
                )
              );

              cropRef.current = {
                x: cropX,
                y: cropY,
                size: cropSize,
              };

              // 데이터로 저장될 영역 표시
              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 5;

              ctx.strokeRect(
                cropX,
                cropY,
                cropSize,
                cropSize
              );

              ctx.fillStyle =
                "rgba(250, 204, 21, 0.15)";

              ctx.fillRect(
                cropX,
                cropY,
                cropSize,
                cropSize
              );

              // 손 랜드마크 점
              for (const landmarks of result.landmarks) {
                for (const point of landmarks) {
                  ctx.beginPath();

                  ctx.arc(
                    point.x * canvas.width,
                    point.y * canvas.height,
                    5,
                    0,
                    Math.PI * 2
                  );

                  ctx.fillStyle = "#22c55e";
                  ctx.fill();
                }
              }
            } else {
              cropRef.current = null;
            }

            lastVideoTimeRef.current =
              video.currentTime;
          }

          animationFrameRef.current =
            requestAnimationFrame(render);
        }

        render();
      } catch (error) {
        console.error(error);
        setStatus("ERROR - CHECK CONSOLE");
      }
    }

    initialize();

    return () => {
      cancelled = true;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(
          animationFrameRef.current
        );
      }

      if (stream) {
        stream
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, []);

    async function captureSingleSample() {
        const video = videoRef.current;
        const crop = cropRef.current;

        if (!video || !crop) {
            throw new Error("Hands are not detected");
        }

        const outputCanvas = document.createElement("canvas");

        outputCanvas.width = 320;
        outputCanvas.height = 320;

        const ctx = outputCanvas.getContext("2d");

        if (!ctx) {
            throw new Error("Canvas context unavailable");
        }

        ctx.drawImage(
            video,

            crop.x,
            crop.y,
            crop.size,
            crop.size,

            0,
            0,
            320,
            320
        );

        const blob = await new Promise<Blob | null>((resolve) => {
            outputCanvas.toBlob(resolve, "image/jpeg", 0.92);
        });

        if (!blob) {
            throw new Error("Failed to create image");
        }

        const formData = new FormData();

        formData.append("label", label);
        formData.append("image", blob, `${label}.jpg`);

        const response = await fetch("/api/capture", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error("Failed to save sample");
        }

        return response.json();
        }

        function wait(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
        }

        async function startCaptureSession() {
        if (isSaving) return;

        try {
            setIsSaving(true);
            setSessionProgress(0);

            // 준비 시간
            for (let number = 3; number >= 1; number--) {
            setCountdown(number);
            setStatus(`GET READY... ${number}`);
            await wait(1000);
            }

            setCountdown(null);

            const totalSamples = 10;

            for (let i = 1; i <= totalSamples; i++) {
            setStatus(`CAPTURING ${i} / ${totalSamples}`);

            try {
                const data = await captureSingleSample();

                setCounts((previous) => ({
                ...previous,
                [label]: data.count,
                }));

                setSessionProgress(i);
            } catch (error) {
                console.warn(`Sample ${i} skipped`, error);
            }

            // 0.5초 간격
            if (i < totalSamples) {
                await wait(500);
            }
            }

            setStatus(`SESSION COMPLETE - ${totalSamples} SAMPLES`);
        } catch (error) {
            console.error(error);
            setStatus("CAPTURE SESSION FAILED");
        } finally {
            setCountdown(null);
            setIsSaving(false);
        }
    }

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <p className="mb-2 text-sm tracking-[0.35em] text-yellow-400">
            NINJA VISION
          </p>

          <h1 className="text-4xl font-bold md:text-6xl">
            DATA COLLECTION
          </h1>

          <p className="mt-3 text-zinc-400">
            Hand Seal Dataset Collector
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                transform: "scaleX(-1)",
              }}
            />

            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full"
              style={{
                transform: "scaleX(-1)",
              }}
            />

            <div className="absolute left-4 top-4 rounded-lg bg-black/70 px-4 py-3">
              <p className="text-xs text-zinc-400">
                TRACKING
              </p>

              <p className="font-mono text-green-400">
                {handCount} HAND
                {handCount === 1 ? "" : "S"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-xs tracking-widest text-zinc-500">
              CURRENT LABEL
            </p>

            <div className="mt-3 text-2xl font-bold">
              {label === "shadow_clone"
                ? "影分身"
                : "NONE"}
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() =>
                  setLabel("shadow_clone")
                }
                className={`w-full rounded-xl border p-4 text-left ${
                  label === "shadow_clone"
                    ? "border-yellow-400 bg-yellow-400/10"
                    : "border-zinc-800"
                }`}
              >
                <div className="font-bold">
                  SHADOW CLONE
                </div>

                <div className="mt-1 text-sm text-zinc-500">
                  {
                    counts.shadow_clone
                  }{" "}
                  samples
                </div>
              </button>

              <button
                onClick={() =>
                  setLabel("none")
                }
                className={`w-full rounded-xl border p-4 text-left ${
                  label === "none"
                    ? "border-yellow-400 bg-yellow-400/10"
                    : "border-zinc-800"
                }`}
              >
                <div className="font-bold">
                  NONE
                </div>

                <div className="mt-1 text-sm text-zinc-500">
                  {counts.none} samples
                </div>
              </button>
            </div>

            <button
            onClick={startCaptureSession}
            disabled={isSaving}
            className="mt-6 w-full rounded-xl bg-yellow-400 px-5 py-4 font-bold text-black disabled:opacity-50"
            >
            {isSaving
                ? countdown !== null
                ? `GET READY... ${countdown}`
                : `CAPTURING ${sessionProgress} / 10`
                : "START CAPTURE SESSION"}
            </button>

            <div className="mt-5 rounded-xl bg-black p-4">
              <p className="text-xs text-zinc-500">
                STATUS
              </p>

              <p className="mt-1 font-mono text-sm text-green-400">
                {status}
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}