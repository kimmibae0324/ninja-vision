"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

type CropBox = {
  x: number;
  y: number;
  size: number;
};

type Prediction = {
  label: "shadow_clone" | "none";
  confidence: number;
  shadow_clone_probability: number;
  none_probability: number;
};

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],

  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],

  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],

  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],

  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const latestAiBlobRef = useRef<Blob | null>(null);

  const [hasAiSample, setHasAiSample] =
    useState(false);

  const [isSavingCorrection, setIsSavingCorrection] =
    useState(false);

  const [correctionStatus, setCorrectionStatus] =
    useState("NO CORRECTION SAVED");

  // AI가 실제로 보는 320x320 이미지를 표시할 캔버스
  const aiPreviewRef = useRef<HTMLCanvasElement>(null);

  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const cropRef = useRef<CropBox | null>(null);

  // 최근 두 손이 정상적으로 잡혔던 Crop 영역 기억
  const lastTwoHandCropRef = useRef<CropBox | null>(null);
  const lastTwoHandTimeRef = useRef(0);

  // Crop 박스 흔들림 완화
  const smoothedCropRef = useRef<CropBox | null>(null);

  // AI API 요청 중복 방지
  const predictingRef = useRef(false);
  const lastPredictionTimeRef = useRef(0);

  const [handCount, setHandCount] = useState(0);

  const [status, setStatus] =
    useState("INITIALIZING...");

  const [prediction, setPrediction] =
    useState<Prediction | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    function smoothCrop(next: CropBox) {
      const previous = smoothedCropRef.current;

      if (!previous) {
        smoothedCropRef.current = next;
        return next;
      }

      const alpha = 0.35;

      const smoothed: CropBox = {
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

    function clearAiPreview() {
      const previewCanvas =
        aiPreviewRef.current;

      if (!previewCanvas) return;

      const ctx =
        previewCanvas.getContext("2d");

      if (!ctx) return;

      ctx.clearRect(
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );
    }

    async function runPrediction() {
      const video = videoRef.current;
      const crop = cropRef.current;

      if (
        !video ||
        !crop ||
        predictingRef.current
      ) {
        return;
      }

      predictingRef.current = true;

      try {
        const outputCanvas =
          document.createElement("canvas");

        outputCanvas.width = 320;
        outputCanvas.height = 320;

        const ctx =
          outputCanvas.getContext("2d");

        if (!ctx) {
          throw new Error(
            "Could not create prediction canvas"
          );
        }

        /*
         * 데이터 수집 때와 같은 방식으로
         * 실제 영상에서 손 영역 Crop
         */
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

        /*
         * AI에게 보내는 정확히 같은 이미지를
         * 오른쪽 AI VIEW에도 표시
         */
        const previewCanvas =
          aiPreviewRef.current;

        if (previewCanvas) {
          previewCanvas.width = 320;
          previewCanvas.height = 320;

          const previewCtx =
            previewCanvas.getContext("2d");

          if (previewCtx) {
            previewCtx.clearRect(
              0,
              0,
              320,
              320
            );

            previewCtx.drawImage(
              outputCanvas,
              0,
              0,
              320,
              320
            );
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
            "Could not create prediction image"
          );
        }

        latestAiBlobRef.current = blob;
        setHasAiSample(true);

        const formData = new FormData();

        formData.append(
          "image",
          blob,
          "hand.jpg"
        );

        const response = await fetch(
          "http://127.0.0.1:8000/predict",
          {
            method: "POST",
            body: formData,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Prediction failed: ${response.status}`
          );
        }

        const data: Prediction =
          await response.json();

        setPrediction(data);
        setStatus("AI SYSTEM ONLINE");
      } catch (error) {
        console.error(error);

        setStatus("AI SERVER ERROR");
      } finally {
        predictingRef.current = false;
      }
    }

    async function initialize() {
      try {
        setStatus(
          "LOADING HAND TRACKER..."
        );

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

        setStatus(
          "REQUESTING CAMERA..."
        );

        stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              width: 1280,
              height: 720,
              facingMode: "user",
            },
            audio: false,
          });

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        const video = videoRef.current;

        if (!video) return;

        video.srcObject = stream;

        await video.play();

        setStatus("AI SYSTEM ONLINE");

        function render() {
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (!video || !canvas) return;

          if (
            video.readyState >= 2 &&
            video.currentTime !==
              lastVideoTimeRef.current
          ) {
            canvas.width =
              video.videoWidth;

            canvas.height =
              video.videoHeight;

            const ctx =
              canvas.getContext("2d");

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

            if (allLandmarks.length > 0) {
              const xs =
                allLandmarks.map(
                  (point) =>
                    point.x *
                    canvas.width
                );

              const ys =
                allLandmarks.map(
                  (point) =>
                    point.y *
                    canvas.height
                );

              const minX =
                Math.min(...xs);

              const maxX =
                Math.max(...xs);

              const minY =
                Math.min(...ys);

              const maxY =
                Math.max(...ys);

              const width =
                maxX - minX;

              const height =
                maxY - minY;

              const centerX =
                (minX + maxX) / 2;

              const centerY =
                (minY + maxY) / 2;

              /*
               * 데이터 수집 때 사용했던 것과
               * 같은 Crop 비율
               */
              const multiplier =
                detectedHands >= 2
                  ? 1.55
                  : 1.7;

              let size =
                Math.max(
                  width,
                  height
                ) * multiplier;

              size = Math.max(
                size,
                210
              );

              size = Math.min(
                size,
                canvas.width,
                canvas.height
              );

              let x =
                centerX - size / 2;

              let y =
                centerY - size / 2;

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

              let nextCrop: CropBox = {
                x,
                y,
                size,
              };

              /*
               * 두 손이 정상적으로 잡혔을 때
               * Crop 영역 기억
               */
              if (
                detectedHands >= 2
              ) {
                lastTwoHandCropRef.current =
                  nextCrop;

                lastTwoHandTimeRef.current =
                  performance.now();
              }

              /*
               * 손이 겹쳐서 잠깐 한 손만
               * 인식되면 직전 두 손 영역 유지
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

              cropRef.current =
                finalCrop;

              /*
               * 노란 박스 =
               * 실제 AI가 보고 있는 영역
               */
              ctx.strokeStyle =
                "#facc15";

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

              /*
               * 손 연결선 + 랜드마크
               */
              for (
                const landmarks
                of result.landmarks
              ) {
                ctx.strokeStyle =
                  "#22c55e";

                ctx.lineWidth = 3;

                for (
                  const [
                    startIndex,
                    endIndex,
                  ] of HAND_CONNECTIONS
                ) {
                  const start =
                    landmarks[
                      startIndex
                    ];

                  const end =
                    landmarks[
                      endIndex
                    ];

                  ctx.beginPath();

                  ctx.moveTo(
                    start.x *
                      canvas.width,
                    start.y *
                      canvas.height
                  );

                  ctx.lineTo(
                    end.x *
                      canvas.width,
                    end.y *
                      canvas.height
                  );

                  ctx.stroke();
                }

                for (
                  const point
                  of landmarks
                ) {
                  ctx.beginPath();

                  ctx.arc(
                    point.x *
                      canvas.width,
                    point.y *
                      canvas.height,
                    5,
                    0,
                    Math.PI * 2
                  );

                  ctx.fillStyle =
                    "#ffffff";

                  ctx.fill();

                  ctx.strokeStyle =
                    "#22c55e";

                  ctx.lineWidth = 2;

                  ctx.stroke();
                }
              }

              /*
               * 약 0.7초마다 AI 서버 호출
               */
              const now =
                performance.now();

              if (
                now -
                  lastPredictionTimeRef.current >
                700
              ) {
                lastPredictionTimeRef.current =
                  now;

                void runPrediction();
              }
            } else {
              cropRef.current = null;

              smoothedCropRef.current =
                null;

              lastTwoHandCropRef.current =
                null;

              setPrediction(null);
            }

            lastVideoTimeRef.current =
              video.currentTime;
          }

          animationFrameRef.current =
            requestAnimationFrame(
              render
            );
        }

        render();
      } catch (error) {
        console.error(error);

        setStatus(
          "ERROR - CHECK CONSOLE"
        );
      }
    }

    initialize();

    return () => {
      cancelled = true;

      if (
        animationFrameRef.current !==
        null
      ) {
        cancelAnimationFrame(
          animationFrameRef.current
        );
      }

      if (stream) {
        stream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }
    };
  }, []);

  async function saveCorrection(
    label: "shadow_clone" | "none"
  ) {
    const blob = latestAiBlobRef.current;

    if (!blob) {
      setCorrectionStatus(
        "NO AI FRAME AVAILABLE"
      );
      return;
    }

    if (isSavingCorrection) return;

    try {
      setIsSavingCorrection(true);

      setCorrectionStatus(
        `SAVING AS ${label.toUpperCase()}...`
      );

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
          "Failed to save correction"
        );
      }

      const data = await response.json();

      setCorrectionStatus(
        `SAVED AS ${label.toUpperCase()} · TOTAL ${data.count}`
      );
    } catch (error) {
      console.error(error);

      setCorrectionStatus(
        "FAILED TO SAVE CORRECTION"
      );
    } finally {
      setIsSavingCorrection(false);
    }
  }

  const shadowProbability =
    prediction?.shadow_clone_probability ??
    0;

  const noneProbability =
    prediction?.none_probability ??
    0;

  const shadowPercent =
    Math.round(
      shadowProbability * 100
    );

  const nonePercent =
    Math.round(
      noneProbability * 100
    );

  /*
   * 현재 테스트용 기준
   *
   * Shadow Clone >= 55%
   * None <= 35%
   * 그 사이 = Uncertain
   */
  const currentSeal =
    !prediction
      ? "WAITING"
      : shadowProbability >= 0.55
        ? "SHADOW CLONE"
        : shadowProbability <= 0.35
          ? "NONE"
          : "UNCERTAIN";

  const sealDetected =
    currentSeal ===
    "SHADOW CLONE";

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        {/* HEADER */}
        <div className="mb-6">
          <p className="mb-2 text-sm tracking-[0.35em] text-green-400">
            REAL-TIME NINJUTSU SYSTEM
          </p>

          <h1 className="text-4xl font-black md:text-6xl">
            NINJA VISION
          </h1>

          <p className="mt-3 text-zinc-400">
            AI Hand Seal Recognition
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* CAMERA */}
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                transform:
                  "scaleX(-1)",
              }}
            />

            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full"
              style={{
                transform:
                  "scaleX(-1)",
              }}
            />

            <div className="absolute left-4 top-4 rounded-xl bg-black/70 px-4 py-3 backdrop-blur">
              <p className="text-xs text-zinc-500">
                HAND TRACKING
              </p>

              <p className="font-mono text-green-400">
                {handCount === 0
                  ? "NO HAND"
                  : `${handCount} HAND${
                      handCount > 1
                        ? "S"
                        : ""
                    } DETECTED`}
              </p>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            {/* CURRENT SEAL */}
            <p className="text-xs tracking-[0.25em] text-zinc-500">
              CURRENT SEAL
            </p>

            <div
              className={`mt-4 text-3xl font-black ${
                sealDetected
                  ? "text-yellow-400"
                  : currentSeal ===
                      "UNCERTAIN"
                    ? "text-orange-400"
                    : currentSeal ===
                        "NONE"
                      ? "text-green-400"
                      : "text-white"
              }`}
            >
              {currentSeal}
            </div>

            {/* SHADOW CLONE */}
            <div className="mt-8">
              <div className="flex items-end justify-between">
                <span className="text-sm font-bold">
                  SHADOW CLONE
                </span>

                <span className="font-mono text-xl text-yellow-400">
                  {prediction
                    ? `${shadowPercent}%`
                    : "--"}
                </span>
              </div>

              <div className="mt-2 h-3 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-yellow-400 transition-all duration-300"
                  style={{
                    width: `${shadowPercent}%`,
                  }}
                />
              </div>
            </div>

            {/* NONE */}
            <div className="mt-6">
              <div className="flex items-end justify-between">
                <span className="text-sm font-bold">
                  NONE
                </span>

                <span className="font-mono text-xl text-green-400">
                  {prediction
                    ? `${nonePercent}%`
                    : "--"}
                </span>
              </div>

              <div className="mt-2 h-3 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-green-400 transition-all duration-300"
                  style={{
                    width: `${nonePercent}%`,
                  }}
                />
              </div>
            </div>

            {/* SEAL STATUS */}
            <div className="mt-8 border-t border-zinc-800 pt-5">
              <p className="text-xs text-zinc-500">
                SEAL STATUS
              </p>

              <p
                className={`mt-2 font-mono font-bold ${
                  sealDetected
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {sealDetected
                  ? "SEAL DETECTED"
                  : "STANDBY"}
              </p>
            </div>

            {/* AI VIEW */}
            <div className="mt-6 border-t border-zinc-800 pt-5">
              <div className="flex items-center justify-between">
                <p className="text-xs tracking-[0.25em] text-zinc-500">
                  AI VIEW
                </p>

                <p className="text-xs text-zinc-600">
                  320 × 320 INPUT
                </p>
              </div>

              <div className="mt-3 aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-black">
                <canvas
                  ref={aiPreviewRef}
                  width={320}
                  height={320}
                  className="h-full w-full object-cover"
                />
              </div>

              <p className="mt-2 text-xs leading-5 text-zinc-500">
                모델이 실제로 판별하고 있는
                이미지입니다.
              </p>

              <div className="mt-5 border-t border-zinc-800 pt-5">
                <p className="text-xs tracking-[0.2em] text-zinc-500">
                  CORRECT AI
                </p>

                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  AI가 틀렸다면 마지막 AI VIEW를
                  올바른 라벨로 저장하세요.
                </p>

                <button
                  onClick={() =>
                    saveCorrection("shadow_clone")
                  }
                  disabled={
                    !hasAiSample ||
                    isSavingCorrection
                  }
                  className="mt-4 w-full rounded-xl bg-yellow-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-30"
                >
                  ADD AS SHADOW CLONE
                </button>

                <button
                  onClick={() =>
                    saveCorrection("none")
                  }
                  disabled={
                    !hasAiSample ||
                    isSavingCorrection
                  }
                  className="mt-3 w-full rounded-xl border border-green-500 px-4 py-3 text-sm font-bold text-green-400 disabled:opacity-30"
                >
                  ADD AS NONE
                </button>

                <div className="mt-4 rounded-lg bg-black px-3 py-3">
                  <p className="font-mono text-xs text-zinc-400">
                    {correctionStatus}
                  </p>
                </div>
              </div>
            </div>

            {/* SYSTEM STATUS */}
            <div className="mt-6 rounded-xl bg-black p-4">
              <p className="text-xs text-zinc-500">
                SYSTEM STATUS
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