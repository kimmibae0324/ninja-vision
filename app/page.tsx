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

const OUTPUT_SIZE = 320;
const PREVIEW_SIZE = 32;

export default function CollectPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cropRef = useRef<CropBox | null>(null);

  // 최근 두 손이 정상적으로 잡혔던 영역 기억
  const lastTwoHandCropRef = useRef<CropBox | null>(null);
  const lastTwoHandTimeRef = useRef(0);

  // Crop 박스 흔들림 줄이기
  const smoothedCropRef = useRef<CropBox | null>(null);

  // 중복 이미지 판별용
  const previousSampleRef = useRef<Uint8ClampedArray | null>(
    null
  );

  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [label, setLabel] =
    useState<Label>("shadow_clone");

  const [handCount, setHandCount] = useState(0);

  const [status, setStatus] =
    useState("INITIALIZING...");

  const [isSaving, setIsSaving] = useState(false);

  const [countdown, setCountdown] =
    useState<number | null>(null);

  const [sessionProgress, setSessionProgress] =
    useState(0);

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

        function smoothCrop(next: CropBox) {
          const previous = smoothedCropRef.current;

          if (!previous) {
            smoothedCropRef.current = next;
            return next;
          }

          const alpha = 0.35;

          const smoothed = {
            x:
              previous.x * (1 - alpha) +
              next.x * alpha,
            y:
              previous.y * (1 - alpha) +
              next.y * alpha,
            size:
              previous.size * (1 - alpha) +
              next.size * alpha,
          };

          smoothedCropRef.current = smoothed;

          return smoothed;
        }

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

            const detectedHands =
              result.landmarks.length;

            setHandCount(detectedHands);

            const allLandmarks =
              result.landmarks.flat();

            let nextCrop: CropBox | null = null;

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

              const width = maxX - minX;
              const height = maxY - minY;

              const centerX =
                (minX + maxX) / 2;

              const centerY =
                (minY + maxY) / 2;

              /*
               * 기존 2.4배보다 훨씬 타이트하게.
               * 두 손이면 1.55배,
               * 한 손이면 1.7배.
               */
              const multiplier =
                detectedHands >= 2 ? 1.55 : 1.7;

              let size =
                Math.max(width, height) *
                multiplier;

              // 너무 작은 Crop 방지
              size = Math.max(size, 210);

              size = Math.min(
                size,
                canvas.width,
                canvas.height
              );

              let x = centerX - size / 2;
              let y = centerY - size / 2;

              x = Math.max(
                0,
                Math.min(
                  x,
                  canvas.width - size
                )
              );

              y = Math.max(
                0,
                Math.min(
                  y,
                  canvas.height - size
                )
              );

              nextCrop = {
                x,
                y,
                size,
              };

              /*
               * 두 손이 제대로 감지됐으면
               * 그 위치를 기억한다.
               */
              if (detectedHands >= 2) {
                lastTwoHandCropRef.current =
                  nextCrop;

                lastTwoHandTimeRef.current =
                  performance.now();
              }

              /*
               * 방금까지 두 손이 잡혀 있었는데
               * 잠깐 한 손으로 떨어졌다면
               * 마지막 두 손 Crop을 유지한다.
               */
              if (
                detectedHands === 1 &&
                lastTwoHandCropRef.current &&
                performance.now() -
                  lastTwoHandTimeRef.current <
                  900
              ) {
                nextCrop =
                  lastTwoHandCropRef.current;
              }

              const finalCrop =
                smoothCrop(nextCrop);

              cropRef.current = finalCrop;

              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 5;

              ctx.strokeRect(
                finalCrop.x,
                finalCrop.y,
                finalCrop.size,
                finalCrop.size
              );

              ctx.fillStyle =
                "rgba(250, 204, 21, 0.08)";

              ctx.fillRect(
                finalCrop.x,
                finalCrop.y,
                finalCrop.size,
                finalCrop.size
              );

              // 랜드마크
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
              smoothedCropRef.current = null;
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

      if (
        animationFrameRef.current !== null
      ) {
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

  function wait(ms: number) {
    return new Promise((resolve) =>
      setTimeout(resolve, ms)
    );
  }

  /*
   * 32x32 축소 이미지를 만들어
   * 이전 사진과 얼마나 다른지 계산
   */
  function getPreviewPixels(
    sourceCanvas: HTMLCanvasElement
  ) {
    const preview =
      document.createElement("canvas");

    preview.width = PREVIEW_SIZE;
    preview.height = PREVIEW_SIZE;

    const ctx = preview.getContext("2d");

    if (!ctx) {
      throw new Error(
        "Preview canvas unavailable"
      );
    }

    ctx.drawImage(
      sourceCanvas,
      0,
      0,
      PREVIEW_SIZE,
      PREVIEW_SIZE
    );

    return ctx.getImageData(
      0,
      0,
      PREVIEW_SIZE,
      PREVIEW_SIZE
    ).data;
  }

  function calculateDifference(
    a: Uint8ClampedArray,
    b: Uint8ClampedArray
  ) {
    let total = 0;
    let count = 0;

    // RGB만 비교, alpha 제외
    for (let i = 0; i < a.length; i += 4) {
      total += Math.abs(a[i] - b[i]);
      total += Math.abs(
        a[i + 1] - b[i + 1]
      );
      total += Math.abs(
        a[i + 2] - b[i + 2]
      );

      count += 3;
    }

    return total / count;
  }

  async function captureSingleSample() {
    const video = videoRef.current;
    const crop = cropRef.current;

    if (!video || !crop) {
      return {
        saved: false,
        reason: "no-hand",
      };
    }

    const outputCanvas =
      document.createElement("canvas");

    outputCanvas.width = OUTPUT_SIZE;
    outputCanvas.height = OUTPUT_SIZE;

    const ctx =
      outputCanvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "Canvas context unavailable"
      );
    }

    ctx.drawImage(
      video,

      crop.x,
      crop.y,
      crop.size,
      crop.size,

      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    );

    /*
     * 거의 같은 사진이면 저장하지 않음
     */
    const currentPixels =
      getPreviewPixels(outputCanvas);

    const previousPixels =
      previousSampleRef.current;

    if (previousPixels) {
      const difference =
        calculateDifference(
          previousPixels,
          currentPixels
        );

      if (difference < 5) {
        return {
          saved: false,
          reason: "duplicate",
        };
      }
    }

    const blob =
      await new Promise<Blob | null>(
        (resolve) => {
          outputCanvas.toBlob(
            resolve,
            "image/jpeg",
            0.92
          );
        }
      );

    if (!blob) {
      throw new Error(
        "Failed to create image"
      );
    }

    const formData = new FormData();

    formData.append("label", label);

    formData.append(
      "image",
      blob,
      `${label}.jpg`
    );

    const response = await fetch(
      "/api/capture",
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(
        "Failed to save sample"
      );
    }

    const data = await response.json();

    previousSampleRef.current =
      currentPixels;

    return {
      saved: true,
      count: data.count,
    };
  }

  async function startCaptureSession() {
    if (isSaving) return;

    try {
      setIsSaving(true);
      setSessionProgress(0);

      // 새 세션이면 중복 기준도 리셋
      previousSampleRef.current = null;

      for (
        let number = 3;
        number >= 1;
        number--
      ) {
        setCountdown(number);

        setStatus(
          `GET READY... ${number}`
        );

        await wait(1000);
      }

      setCountdown(null);

      const targetSamples = 10;

      let savedSamples = 0;
      let attempts = 0;

      /*
       * 10장을 확보하되,
       * 너무 비슷하면 건너뛰기 때문에
       * 최대 25번까지만 시도.
       */
      while (
        savedSamples < targetSamples &&
        attempts < 25
      ) {
        attempts++;

        setStatus(
          `CAPTURING ${
            savedSamples + 1
          } / ${targetSamples}`
        );

        const result =
          await captureSingleSample();

        if (result.saved) {
          savedSamples++;

          setSessionProgress(
            savedSamples
          );

          if (result.count !== undefined) {
            setCounts((previous) => ({
              ...previous,
              [label]: result.count!,
            }));
          }
        } else if (
          result.reason === "duplicate"
        ) {
          setStatus(
            "TOO SIMILAR - MOVE OR ROTATE YOUR HANDS"
          );
        } else {
          setStatus(
            "HANDS NOT DETECTED"
          );
        }

        // 기존 0.5초 → 0.9초
        await wait(900);
      }

      if (
        savedSamples === targetSamples
      ) {
        setStatus(
          `SESSION COMPLETE - ${savedSamples} SAMPLES`
        );
      } else {
        setStatus(
          `SESSION ENDED - ${savedSamples} VALID SAMPLES`
        );
      }
    } catch (error) {
      console.error(error);

      setStatus(
        "CAPTURE SESSION FAILED"
      );
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
                {handCount === 1
                  ? ""
                  : "S"}
              </p>
            </div>

            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="text-9xl font-black text-yellow-400">
                  {countdown}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-xs tracking-widest text-zinc-500">
              CURRENT LABEL
            </p>

            <div className="mt-3 text-2xl font-bold">
              {label ===
              "shadow_clone"
                ? "影分身"
                : "NONE"}
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={() =>
                  setLabel(
                    "shadow_clone"
                  )
                }
                disabled={isSaving}
                className={`w-full rounded-xl border p-4 text-left ${
                  label ===
                  "shadow_clone"
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
                disabled={isSaving}
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
              onClick={
                startCaptureSession
              }
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

            <div className="mt-4 text-xs leading-5 text-zinc-500">
              촬영 중 손을 조금씩 좌우로
              움직이거나 기울여 주세요.
              <br />
              거의 같은 사진은 자동으로
              제외됩니다.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}