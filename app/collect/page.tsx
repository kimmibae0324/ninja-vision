"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

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

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const cropRef = useRef<CropBox | null>(null);
  const predictingRef = useRef(false);
  const lastPredictionTimeRef = useRef(0);

  const [status, setStatus] = useState("INITIALIZING...");
  const [handCount, setHandCount] = useState(0);

  const [prediction, setPrediction] =
    useState<Prediction | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function startNinjaVision() {
      try {
        setStatus("LOADING HAND TRACKER...");

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const handLandmarker =
          await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            },

            runningMode: "VIDEO",
            numHands: 2,

            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

        if (cancelled) return;

        setStatus("REQUESTING CAMERA...");

        stream = await navigator.mediaDevices.getUserMedia({
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

        setStatus("AI SYSTEM ONLINE");

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

            if (!ctx) return;

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

            if (!blob) return;

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
                "Prediction request failed"
              );
            }

            const data: Prediction =
              await response.json();

            setPrediction(data);
          } catch (error) {
            console.error(error);
            setStatus("AI SERVER ERROR");
          } finally {
            predictingRef.current = false;
          }
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
               * 데이터 수집 때와 비슷한 방식으로
               * 손 주변을 Crop
               */
              const multiplier =
                detectedHands >= 2
                  ? 1.55
                  : 1.8;

              let size =
                Math.max(width, height) *
                multiplier;

              size = Math.max(size, 210);

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

              cropRef.current = {
                x,
                y,
                size,
              };

              // AI가 보고 있는 영역
              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 4;

              ctx.strokeRect(
                x,
                y,
                size,
                size
              );

              // 손 뼈대
              for (const landmarks of result.landmarks) {
                ctx.strokeStyle = "#22ff88";
                ctx.lineWidth = 4;

                for (
                  const [
                    startIndex,
                    endIndex,
                  ] of HAND_CONNECTIONS
                ) {
                  const start =
                    landmarks[startIndex];

                  const end =
                    landmarks[endIndex];

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

                for (const point of landmarks) {
                  ctx.beginPath();

                  ctx.arc(
                    point.x *
                      canvas.width,
                    point.y *
                      canvas.height,
                    6,
                    0,
                    Math.PI * 2
                  );

                  ctx.fillStyle = "#ffffff";
                  ctx.fill();

                  ctx.strokeStyle = "#22ff88";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
              }

              /*
               * AI 요청은 약 0.7초마다 한 번
               */
              const now = performance.now();

              if (
                now -
                  lastPredictionTimeRef.current >
                700
              ) {
                lastPredictionTimeRef.current =
                  now;

                runPrediction();
              }
            } else {
              cropRef.current = null;
              setPrediction(null);
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

    startNinjaVision();

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
          .forEach((track) =>
            track.stop()
          );
      }
    };
  }, []);

  const shadowProbability =
    prediction?.shadow_clone_probability ?? 0;

  const shadowPercent =
    Math.round(shadowProbability * 100);

  const detectedShadowClone =
    shadowProbability >= 0.7;

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <p className="mb-2 text-sm tracking-[0.35em] text-green-400">
            REAL-TIME NINJUTSU SYSTEM
          </p>

          <h1 className="text-4xl font-bold md:text-6xl">
            NINJA VISION
          </h1>

          <p className="mt-3 text-zinc-400">
            AI Hand Seal Recognition
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
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

            <div className="absolute left-4 top-4 rounded-xl bg-black/70 px-4 py-3 backdrop-blur">
              <p className="text-xs text-zinc-400">
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

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <p className="text-xs tracking-widest text-zinc-500">
              CURRENT SEAL
            </p>

            <div
              className={`mt-4 text-3xl font-black ${
                detectedShadowClone
                  ? "text-yellow-400"
                  : "text-zinc-300"
              }`}
            >
              {prediction
                ? detectedShadowClone
                  ? "SHADOW CLONE"
                  : "NONE"
                : "WAITING..."}
            </div>

            <div className="mt-3 font-mono text-5xl font-bold">
              {prediction
                ? `${shadowPercent}%`
                : "--"}
            </div>

            <p className="mt-2 text-xs text-zinc-500">
              Shadow Clone probability
            </p>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-yellow-400 transition-all duration-300"
                style={{
                  width: `${shadowPercent}%`,
                }}
              />
            </div>

            <div className="mt-8 border-t border-zinc-800 pt-5">
              <p className="text-xs text-zinc-500">
                SEAL STATUS
              </p>

              <p
                className={`mt-2 font-mono font-bold ${
                  detectedShadowClone
                    ? "text-yellow-400"
                    : "text-green-400"
                }`}
              >
                {detectedShadowClone
                  ? "SEAL DETECTED"
                  : "STANDBY"}
              </p>
            </div>

            <div className="mt-6 rounded-xl bg-black p-4">
              <p className="text-xs text-zinc-500">
                SYSTEM
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