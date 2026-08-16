"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
} from "@mediapipe/tasks-vision";

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

  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const handCountRef = useRef(-1);

  const [status, setStatus] = useState("INITIALIZING...");
  const [handCount, setHandCount] = useState(0);

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

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;

        if (!video) return;

        video.srcObject = stream;

        await video.play();

        setStatus("JUTSU SYSTEM : STANDBY");

        function render() {
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (!video || !canvas) return;

          if (
            video.readyState >= 2 &&
            video.currentTime !== lastVideoTimeRef.current
          ) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext("2d");

            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const result = handLandmarker.detectForVideo(
              video,
              performance.now()
            );

            const detectedCount = result.landmarks.length;

            if (detectedCount !== handCountRef.current) {
              handCountRef.current = detectedCount;
              setHandCount(detectedCount);
            }

            for (const landmarks of result.landmarks) {
              // 손가락 뼈 연결선
              ctx.strokeStyle = "#22ff88";
              ctx.lineWidth = 4;

              for (const [startIndex, endIndex] of HAND_CONNECTIONS) {
                const start = landmarks[startIndex];
                const end = landmarks[endIndex];

                ctx.beginPath();

                ctx.moveTo(
                  start.x * canvas.width,
                  start.y * canvas.height
                );

                ctx.lineTo(
                  end.x * canvas.width,
                  end.y * canvas.height
                );

                ctx.stroke();
              }

              // 관절 포인트
              for (const landmark of landmarks) {
                ctx.beginPath();

                ctx.arc(
                  landmark.x * canvas.width,
                  landmark.y * canvas.height,
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

            lastVideoTimeRef.current = video.currentTime;
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

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-5xl">
        <div className="mb-6">
          <p className="text-green-400 text-sm tracking-[0.35em] mb-2">
            REAL-TIME NINJUTSU SYSTEM
          </p>

          <h1 className="text-4xl md:text-6xl font-bold">
            NINJA VISION
          </h1>

          <p className="text-zinc-400 mt-3">
            Computer Vision Hand Seal Recognition
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 aspect-video">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />

          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            style={{ transform: "scaleX(-1)" }}
          />

          <div className="absolute left-4 top-4 rounded-lg bg-black/70 px-4 py-3 backdrop-blur">
            <p className="text-xs text-zinc-400">
              HAND TRACKING
            </p>

            <p className="font-mono text-green-400">
              {handCount === 0
                ? "NO HAND DETECTED"
                : `${handCount} HAND${
                    handCount > 1 ? "S" : ""
                  } DETECTED`}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <div>
            <p className="text-xs text-zinc-500">
              SYSTEM STATUS
            </p>

            <p className="font-mono text-green-400">
              {status}
            </p>
          </div>

          <div
            className={`h-3 w-3 rounded-full ${
              status.includes("STANDBY")
                ? "bg-green-400"
                : "bg-yellow-400"
            }`}
          />
        </div>
      </div>
    </main>
  );
}