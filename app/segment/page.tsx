"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  ImageSegmenter,
} from "@mediapipe/tasks-vision";

export default function SegmentPage() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 사람만 잘라낸 화면
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  // 분신 합성 화면
  const cloneCanvasRef = useRef<HTMLCanvasElement>(null);

  const animationRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [status, setStatus] =
    useState("INITIALIZING...");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function initialize() {
      try {
        setStatus("LOADING PERSON SEGMENTER...");

        const vision =
          await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );

        const segmenter =
          await ImageSegmenter.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
              },

              runningMode: "VIDEO",

              outputCategoryMask: false,
              outputConfidenceMasks: true,
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

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) => track.stop());

          return;
        }

        const video = videoRef.current;

        if (!video) return;

        video.srcObject = stream;

        await video.play();

        setStatus("PERSON SEGMENTATION ONLINE");

        function render() {
          const video = videoRef.current;

          const personCanvas =
            resultCanvasRef.current;

          const cloneCanvas =
            cloneCanvasRef.current;

          if (
            !video ||
            !personCanvas ||
            !cloneCanvas
          ) {
            animationRef.current =
              requestAnimationFrame(render);

            return;
          }

          if (
            video.readyState >= 2 &&
            video.currentTime !==
              lastVideoTimeRef.current
          ) {
            const width = video.videoWidth;
            const height = video.videoHeight;

            personCanvas.width = width;
            personCanvas.height = height;

            cloneCanvas.width = width;
            cloneCanvas.height = height;

            segmenter.segmentForVideo(
              video,
              performance.now(),

              (result) => {
                const masks =
                  result.confidenceMasks;

                if (
                  !masks ||
                  masks.length === 0
                ) {
                  setStatus(
                    "NO CONFIDENCE MASK"
                  );

                  return;
                }

                /*
                 * Selfie Segmenter
                 * 0 = background
                 * 1 = person
                 */
                const personMask =
                  masks.length >= 2
                    ? masks[1]
                    : masks[0];

                const maskWidth =
                  personMask.width;

                const maskHeight =
                  personMask.height;

                const confidence =
                  personMask.getAsFloat32Array();

                /*
                 * ============================
                 * PERSON MASK CANVAS
                 * ============================
                 */

                const maskCanvas =
                  document.createElement(
                    "canvas"
                  );

                maskCanvas.width =
                  maskWidth;

                maskCanvas.height =
                  maskHeight;

                const maskCtx =
                  maskCanvas.getContext(
                    "2d"
                  );

                if (!maskCtx) return;

                const maskImageData =
                  maskCtx.createImageData(
                    maskWidth,
                    maskHeight
                  );

                /*
                 * 동시에 사람 영역의
                 * Bounding Box도 계산한다.
                 */
                let minX = maskWidth;
                let minY = maskHeight;

                let maxX = 0;
                let maxY = 0;

                let personDetected = false;

                for (
                  let y = 0;
                  y < maskHeight;
                  y++
                ) {
                  for (
                    let x = 0;
                    x < maskWidth;
                    x++
                  ) {
                    const i =
                      y * maskWidth + x;

                    const score =
                      confidence[i];

                    const alpha =
                      score <= 0.15
                        ? 0
                        : Math.min(
                            255,
                            Math.round(
                              score * 255
                            )
                          );

                    const pixelIndex =
                      i * 4;

                    maskImageData.data[
                      pixelIndex
                    ] = 255;

                    maskImageData.data[
                      pixelIndex + 1
                    ] = 255;

                    maskImageData.data[
                      pixelIndex + 2
                    ] = 255;

                    maskImageData.data[
                      pixelIndex + 3
                    ] = alpha;

                    /*
                     * 사람일 확률이 충분히
                     * 높은 영역만 bounding box에 사용.
                     */
                    if (score > 0.45) {
                      personDetected = true;

                      if (x < minX) minX = x;
                      if (y < minY) minY = y;

                      if (x > maxX) maxX = x;
                      if (y > maxY) maxY = y;
                    }
                  }
                }

                maskCtx.putImageData(
                  maskImageData,
                  0,
                  0
                );

                /*
                 * ============================
                 * PERSON CUTOUT
                 * ============================
                 */

                const personCtx =
                  personCanvas.getContext(
                    "2d"
                  );

                if (!personCtx) return;

                personCtx.clearRect(
                  0,
                  0,
                  width,
                  height
                );

                personCtx.globalCompositeOperation =
                  "source-over";

                personCtx.drawImage(
                  video,
                  0,
                  0,
                  width,
                  height
                );

                personCtx.globalCompositeOperation =
                  "destination-in";

                personCtx.imageSmoothingEnabled =
                  true;

                personCtx.drawImage(
                  maskCanvas,
                  0,
                  0,
                  maskWidth,
                  maskHeight,
                  0,
                  0,
                  width,
                  height
                );

                personCtx.globalCompositeOperation =
                  "source-over";

                /*
                 * ============================
                 * SHADOW CLONE PREVIEW
                 * ============================
                 */

                const cloneCtx =
                  cloneCanvas.getContext(
                    "2d"
                  );

                if (!cloneCtx) return;

                cloneCtx.clearRect(
                  0,
                  0,
                  width,
                  height
                );

                /*
                 * 1. 원본 카메라 화면
                 */
                cloneCtx.globalAlpha = 1;

                cloneCtx.drawImage(
                  video,
                  0,
                  0,
                  width,
                  height
                );

                /*
                 * 사람 영역을 못 찾았으면
                 * 원본 화면만 표시.
                 */
                if (!personDetected) {
                  setStatus(
                    "SEARCHING FOR PERSON..."
                  );

                  return;
                }

                /*
                 * Mask 좌표 → 실제 Video 좌표
                 */
                const scaleX =
                  width / maskWidth;

                const scaleY =
                  height / maskHeight;

                let sourceX =
                  minX * scaleX;

                let sourceY =
                  minY * scaleY;

                let sourceWidth =
                  (maxX - minX) *
                  scaleX;

                let sourceHeight =
                  (maxY - minY) *
                  scaleY;

                /*
                 * 몸 주변에 약간의 여백 추가
                 */
                const paddingX =
                  sourceWidth * 0.08;

                const paddingY =
                  sourceHeight * 0.04;

                sourceX = Math.max(
                  0,
                  sourceX - paddingX
                );

                sourceY = Math.max(
                  0,
                  sourceY - paddingY
                );

                sourceWidth = Math.min(
                  width - sourceX,
                  sourceWidth +
                    paddingX * 2
                );

                sourceHeight = Math.min(
                  height - sourceY,
                  sourceHeight +
                    paddingY * 2
                );

                /*
                 * 원래 사람의 아래쪽 위치를
                 * 분신들의 기준선으로 사용.
                 */
                const originalBottom =
                  sourceY +
                  sourceHeight;

                /*
                 * 추가 분신 3명
                 *
                 * centerX:
                 * 화면에서 분신의 중심 위치
                 *
                 * scale:
                 * 원본 대비 크기
                 */
                const clones = [
                  {
                    centerX:
                      width * 0.18,

                    scale: 0.72,

                    alpha: 0.78,
                  },

                  {
                    centerX:
                      width * 0.5,

                    scale: 0.66,

                    alpha: 0.7,
                  },

                  {
                    centerX:
                      width * 0.82,

                    scale: 0.74,

                    alpha: 0.8,
                  },
                ];

                for (const clone of clones) {
                  const targetWidth =
                    sourceWidth *
                    clone.scale;

                  const targetHeight =
                    sourceHeight *
                    clone.scale;

                  const targetX =
                    clone.centerX -
                    targetWidth / 2;

                  /*
                   * 바닥을 어느 정도
                   * 동일하게 맞춘다.
                   */
                  const targetY =
                    originalBottom -
                    targetHeight;

                  cloneCtx.globalAlpha =
                    clone.alpha;

                  cloneCtx.drawImage(
                    personCanvas,

                    // source
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,

                    // destination
                    targetX,
                    targetY,
                    targetWidth,
                    targetHeight
                  );
                }

                cloneCtx.globalAlpha = 1;

                setStatus(
                  "SHADOW CLONES ONLINE"
                );
              }
            );

            lastVideoTimeRef.current =
              video.currentTime;
          }

          animationRef.current =
            requestAnimationFrame(
              render
            );
        }

        render();
      } catch (error) {
        console.error(error);

        setStatus(
          "SEGMENTATION ERROR - CHECK CONSOLE"
        );
      }
    }

    initialize();

    return () => {
      cancelled = true;

      if (
        animationRef.current !== null
      ) {
        cancelAnimationFrame(
          animationRef.current
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

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm tracking-[0.35em] text-purple-400">
          NINJA VISION LAB
        </p>

        <h1 className="mt-2 text-4xl font-black">
          SHADOW CLONE LAB
        </h1>

        <p className="mt-3 text-zinc-400">
          Person Segmentation + Clone
          Composition Test
        </p>

        {/* TOP */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* ORIGINAL */}
          <div>
            <p className="mb-3 text-xs tracking-widest text-zinc-500">
              ORIGINAL CAMERA
            </p>

            <div className="aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
                style={{
                  transform:
                    "scaleX(-1)",
                }}
              />
            </div>
          </div>

          {/* PERSON */}
          <div>
            <p className="mb-3 text-xs tracking-widest text-zinc-500">
              PERSON CUTOUT
            </p>

            <div
              className="aspect-video overflow-hidden rounded-2xl border border-zinc-800"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#222 25%,transparent 25%),linear-gradient(-45deg,#222 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#222 75%),linear-gradient(-45deg,transparent 75%,#222 75%)",

                backgroundSize:
                  "24px 24px",

                backgroundPosition:
                  "0 0,0 12px,12px -12px,-12px 0px",
              }}
            >
              <canvas
                ref={resultCanvasRef}
                className="h-full w-full object-cover"
                style={{
                  transform:
                    "scaleX(-1)",
                }}
              />
            </div>
          </div>
        </div>

        {/* CLONE RESULT */}
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs tracking-widest text-yellow-400">
              SHADOW CLONE PREVIEW
            </p>

            <p className="font-mono text-xs text-zinc-500">
              ORIGINAL + 3 CLONES
            </p>
          </div>

          <div className="aspect-video overflow-hidden rounded-2xl border border-yellow-400/30 bg-zinc-950">
            <canvas
              ref={cloneCanvasRef}
              className="h-full w-full object-cover"
              style={{
                transform:
                  "scaleX(-1)",
              }}
            />
          </div>
        </div>

        {/* STATUS */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs text-zinc-500">
            SYSTEM STATUS
          </p>

          <p className="mt-1 font-mono text-green-400">
            {status}
          </p>
        </div>
      </div>
    </main>
  );
}