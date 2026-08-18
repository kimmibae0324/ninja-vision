"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter,
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
  /*
   * ==============================
   * VIDEO / CANVAS
   * ==============================
   */

  const videoRef =
    useRef<HTMLVideoElement>(null);

  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  const aiPreviewRef =
    useRef<HTMLCanvasElement>(null);

  /*
   * 실제 분신을 그릴 투명 Canvas
   */
  const cloneCanvasRef =
    useRef<HTMLCanvasElement>(null);

  /*
   * ==============================
   * CORRECTION DATA
   * ==============================
   */

  const latestAiBlobRef =
    useRef<Blob | null>(null);

  const [hasAiSample, setHasAiSample] =
    useState(false);

  const [
    isSavingCorrection,
    setIsSavingCorrection,
  ] = useState(false);

  const [
    correctionStatus,
    setCorrectionStatus,
  ] = useState(
    "NO CORRECTION SAVED"
  );

  /*
   * ==============================
   * FRAME / HAND TRACKING
   * ==============================
   */

  const animationFrameRef =
    useRef<number | null>(null);

  const lastVideoTimeRef =
    useRef(-1);

  const cropRef =
    useRef<CropBox | null>(null);

  const lastTwoHandCropRef =
    useRef<CropBox | null>(null);

  const lastTwoHandTimeRef =
    useRef(0);

  const smoothedCropRef =
    useRef<CropBox | null>(null);

  /*
   * ==============================
   * AI PREDICTION
   * ==============================
   */

  const predictingRef =
    useRef(false);

  const lastPredictionTimeRef =
    useRef(0);

  const predictionHistoryRef =
    useRef<number[]>([]);

  const [prediction, setPrediction] =
    useState<Prediction | null>(null);

  /*
   * ==============================
   * SEAL CONFIRMATION
   * ==============================
   */

  const [
    sealConfirmed,
    setSealConfirmed,
  ] = useState(false);

  const [
    confirmProgress,
    setConfirmProgress,
  ] = useState(0);

  /*
   * ==============================
   * SHADOW CLONE VFX
   * ==============================
   */

  const [
    jutsuActive,
    setJutsuActive,
  ] = useState(false);

  const [
    flashActive,
    setFlashActive,
  ] = useState(false);

  const [
    smokeActive,
    setSmokeActive,
  ] = useState(false);

  const [
    jutsuTextVisible,
    setJutsuTextVisible,
  ] = useState(false);

  /*
   * render() 안에서는 state가 아니라
   * ref로 현재 발동 상태 확인
   */
  const jutsuActiveRef =
    useRef(false);

  /*
   * 한 번 CONFIRMED 됐을 때
   * 술법이 계속 재발동되는 것 방지
   */
  const jutsuTriggeredRef =
    useRef(false);

  /*
   * Segmentation을 매 프레임 돌리지 않고
   * 약 10 FPS 정도로 제한
   */
  const lastSegmentationTimeRef =
    useRef(0);

  /*
   * VFX 타이머 저장
   */
  const effectTimersRef =
    useRef<number[]>([]);

  /*
   * ==============================
   * BASIC UI
   * ==============================
   */

  const [handCount, setHandCount] =
    useState(0);

  const [status, setStatus] =
    useState("INITIALIZING...");

  /*
   * state → ref 동기화
   */
  useEffect(() => {
    jutsuActiveRef.current =
      jutsuActive;
  }, [jutsuActive]);

  /*
   * ==============================
   * JUTSU TRIGGER
   * ==============================
   */

  useEffect(() => {
    /*
     * SEAL CONFIRMED가 처음 TRUE가 되는 순간
     */
    if (
      sealConfirmed &&
      !jutsuTriggeredRef.current
    ) {
      jutsuTriggeredRef.current =
        true;

      /*
       * 기존 타이머 제거
       */
      effectTimersRef.current.forEach(
        (timer) =>
          window.clearTimeout(timer)
      );

      effectTimersRef.current = [];

      /*
       * 발동!
       */
      setJutsuActive(true);
      setFlashActive(true);
      setSmokeActive(true);
      setJutsuTextVisible(true);

      /*
       * FLASH 약 0.2초
       */
      effectTimersRef.current.push(
        window.setTimeout(() => {
          setFlashActive(false);
        }, 220)
      );

      /*
       * 연기 약 1.4초
       */
      effectTimersRef.current.push(
        window.setTimeout(() => {
          setSmokeActive(false);
        }, 1400)
      );

      /*
       * 술법 이름 약 1.8초
       */
      effectTimersRef.current.push(
        window.setTimeout(() => {
          setJutsuTextVisible(false);
        }, 1800)
      );

      /*
       * 분신은 5초 유지
       */
      effectTimersRef.current.push(
        window.setTimeout(() => {
          setJutsuActive(false);
        }, 5000)
      );
    }

    /*
     * 손을 내리고 confirmation이 풀리면
     * 다음 술법을 다시 쓸 수 있도록 재무장
     */
    if (!sealConfirmed) {
      jutsuTriggeredRef.current =
        false;
    }
  }, [sealConfirmed]);

  /*
   * 컴포넌트가 사라질 때
   * VFX 타이머 정리
   */
  useEffect(() => {
    return () => {
      effectTimersRef.current.forEach(
        (timer) =>
          window.clearTimeout(timer)
      );
    };
  }, []);

  /*
   * ==============================
   * MAIN AI SYSTEM
   * ==============================
   */

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null =
      null;

    /*
     * ==============================
     * CROP SMOOTHING
     * ==============================
     */

    function smoothCrop(
      next: CropBox
    ) {
      const previous =
        smoothedCropRef.current;

      if (!previous) {
        smoothedCropRef.current =
          next;

        return next;
      }

      const alpha = 0.35;

      const smoothed: CropBox = {
        x:
          previous.x *
            (1 - alpha) +
          next.x * alpha,

        y:
          previous.y *
            (1 - alpha) +
          next.y * alpha,

        size:
          previous.size *
            (1 - alpha) +
          next.size * alpha,
      };

      smoothedCropRef.current =
        smoothed;

      return smoothed;
    }

    /*
     * ==============================
     * HAND SEAL PREDICTION
     * ==============================
     */

    async function runPrediction() {
      const video =
        videoRef.current;

      const crop =
        cropRef.current;

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
          document.createElement(
            "canvas"
          );

        outputCanvas.width = 320;
        outputCanvas.height = 320;

        const ctx =
          outputCanvas.getContext(
            "2d"
          );

        if (!ctx) {
          throw new Error(
            "Could not create prediction canvas"
          );
        }

        /*
         * 실제 AI 입력 Crop
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
         * AI VIEW 표시
         */
        const previewCanvas =
          aiPreviewRef.current;

        if (previewCanvas) {
          previewCanvas.width = 320;
          previewCanvas.height = 320;

          const previewCtx =
            previewCanvas.getContext(
              "2d"
            );

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

        /*
         * Blob 생성
         */
        const blob =
          await new Promise<
            Blob | null
          >((resolve) => {
            outputCanvas.toBlob(
              resolve,
              "image/jpeg",
              0.92
            );
          });

        if (!blob) {
          throw new Error(
            "Could not create prediction image"
          );
        }

        /*
         * 오답 수정용 마지막 AI Frame 저장
         */
        latestAiBlobRef.current =
          blob;

        setHasAiSample(true);

        /*
         * FastAPI 전송
         */
        const formData =
          new FormData();

        formData.append(
          "image",
          blob,
          "hand.jpg"
        );

        const response =
          await fetch(
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

        /*
         * ==============================
         * TEMPORAL VERIFICATION
         * ==============================
         */

        const history =
          predictionHistoryRef.current;

        history.push(
          data.shadow_clone_probability
        );

        /*
         * 최근 5개만 기억
         */
        if (history.length > 5) {
          history.shift();
        }

        /*
         * 55% 이상 횟수
         */
        const positiveCount =
          history.filter(
            (value) =>
              value >= 0.55
          ).length;

        /*
         * 최근 확률 평균
         */
        const average =
          history.reduce(
            (sum, value) =>
              sum + value,
            0
          ) / history.length;

        /*
         * Progress
         */
        setConfirmProgress(
          Math.min(
            Math.round(
              (positiveCount / 4) *
                100
            ),
            100
          )
        );

        /*
         * 최근 최소 4개
         * 3개 이상 55%+
         * 평균 52%+
         */
        if (
          history.length >= 4 &&
          positiveCount >= 3 &&
          average >= 0.52
        ) {
          setSealConfirmed(true);
        } else if (
          average < 0.35
        ) {
          /*
           * NONE으로 확실히 돌아오면
           * verification reset
           */
          predictionHistoryRef.current =
            [];

          setConfirmProgress(0);
          setSealConfirmed(false);
        }

        setStatus(
          "AI SYSTEM ONLINE"
        );
      } catch (error) {
        console.error(error);

        setStatus(
          "AI SERVER ERROR"
        );
      } finally {
        predictingRef.current =
          false;
      }
    }

    /*
     * ==============================
     * PERSON SEGMENTATION
     * ==============================
     */

    function runCloneSegmentation(
      segmenter: ImageSegmenter
    ) {
      const video =
        videoRef.current;

      const cloneCanvas =
        cloneCanvasRef.current;

      if (
        !video ||
        !cloneCanvas ||
        !jutsuActiveRef.current
      ) {
        return;
      }

      const width =
        video.videoWidth;

      const height =
        video.videoHeight;

      if (
        width === 0 ||
        height === 0
      ) {
        return;
      }

      /*
       * Canvas 크기 맞춤
       */
      if (
        cloneCanvas.width !==
          width ||
        cloneCanvas.height !==
          height
      ) {
        cloneCanvas.width = width;
        cloneCanvas.height = height;
      }

      /*
       * MediaPipe Person Segmentation
       */
      segmenter.segmentForVideo(
        video,
        performance.now(),
        (result) => {
          /*
           * 술법이 도중에 끝났으면 중단
           */
          if (
            !jutsuActiveRef.current
          ) {
            return;
          }

          const masks =
            result.confidenceMasks;

          if (
            !masks ||
            masks.length === 0
          ) {
            return;
          }

          /*
           * Selfie Segmenter
           *
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
           * ==============================
           * PERSON MASK 생성
           * ==============================
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
           * Bounding Box
           */
          let minX = maskWidth;
          let minY = maskHeight;

          let maxX = 0;
          let maxY = 0;

          let personDetected =
            false;

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

              /*
               * 약한 background 제거
               */
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
               * 사람 영역 Bounding Box
               */
              if (score > 0.45) {
                personDetected =
                  true;

                if (x < minX)
                  minX = x;

                if (y < minY)
                  minY = y;

                if (x > maxX)
                  maxX = x;

                if (y > maxY)
                  maxY = y;
              }
            }
          }

          maskCtx.putImageData(
            maskImageData,
            0,
            0
          );

          const cloneCtx =
            cloneCanvas.getContext(
              "2d"
            );

          if (!cloneCtx) return;

          /*
           * 이전 분신 Frame 제거
           */
          cloneCtx.clearRect(
            0,
            0,
            width,
            height
          );

          if (!personDetected) {
            return;
          }

          /*
           * ==============================
           * PERSON CUTOUT
           * ==============================
           */

          const personCanvas =
            document.createElement(
              "canvas"
            );

          personCanvas.width =
            width;

          personCanvas.height =
            height;

          const personCtx =
            personCanvas.getContext(
              "2d"
            );

          if (!personCtx) return;

          /*
           * 원본 video
           */
          personCtx.drawImage(
            video,
            0,
            0,
            width,
            height
          );

          /*
           * 사람 Mask와 겹치는 부분만 남김
           */
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
           * ==============================
           * MASK 좌표 → VIDEO 좌표
           * ==============================
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
            Math.max(
              1,
              (maxX - minX + 1) *
                scaleX
            );

          let sourceHeight =
            Math.max(
              1,
              (maxY - minY + 1) *
                scaleY
            );

          /*
           * 몸 주변 여백
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
           * 현재 사람의 바닥선
           */
          const originalBottom =
            sourceY +
            sourceHeight;

          /*
           * ==============================
           * SHADOW CLONES
           * ==============================
           *
           * 원본 사람은 실제 video에 이미 있음.
           * 여기서는 분신 3명만 그린다.
           */

          const clones = [
            /*
             * 뒤쪽 중앙
             */
            {
              centerX:
                width * 0.5,

              scale: 0.62,

              bottomOffset: -55,

              alpha: 0.82,
            },

            /*
             * 왼쪽
             */
            {
              centerX:
                width * 0.17,

              scale: 0.76,

              bottomOffset: 5,

              alpha: 0.94,
            },

            /*
             * 오른쪽
             */
            {
              centerX:
                width * 0.83,

              scale: 0.76,

              bottomOffset: 5,

              alpha: 0.94,
            },
          ];

          /*
           * 뒤쪽 분신부터 Draw
           */
          for (
            const clone of clones
          ) {
            const targetWidth =
              sourceWidth *
              clone.scale;

            const targetHeight =
              sourceHeight *
              clone.scale;

            const targetX =
              clone.centerX -
              targetWidth / 2;

            const targetY =
              originalBottom -
              targetHeight +
              clone.bottomOffset;

            cloneCtx.globalAlpha =
              clone.alpha;

            cloneCtx.drawImage(
              personCanvas,

              /*
               * SOURCE
               */
              sourceX,
              sourceY,
              sourceWidth,
              sourceHeight,

              /*
               * DESTINATION
               */
              targetX,
              targetY,
              targetWidth,
              targetHeight
            );
          }

          cloneCtx.globalAlpha = 1;
        }
      );
    }

    /*
     * ==============================
     * INITIALIZE
     * ==============================
     */

    async function initialize() {
      try {
        /*
         * MediaPipe WASM
         */
        setStatus(
          "LOADING MEDIAPIPE..."
        );

        const vision =
          await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          );

        /*
         * ==============================
         * HAND LANDMARKER
         * ==============================
         */

        setStatus(
          "LOADING HAND TRACKER..."
        );

        const handLandmarker =
          await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              },

              runningMode:
                "VIDEO",

              numHands: 2,

              minHandDetectionConfidence:
                0.5,

              minHandPresenceConfidence:
                0.5,

              minTrackingConfidence:
                0.5,
            }
          );

        /*
         * ==============================
         * PERSON SEGMENTER
         * ==============================
         */

        setStatus(
          "LOADING SHADOW CLONE VFX..."
        );

        const imageSegmenter =
          await ImageSegmenter.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
              },

              runningMode:
                "VIDEO",

              outputCategoryMask:
                false,

              outputConfidenceMasks:
                true,
            }
          );

        if (cancelled) return;

        /*
         * ==============================
         * CAMERA
         * ==============================
         */

        setStatus(
          "REQUESTING CAMERA..."
        );

        stream =
          await navigator.mediaDevices.getUserMedia(
            {
              video: {
                width: 1280,
                height: 720,
                facingMode:
                  "user",
              },

              audio: false,
            }
          );

        if (cancelled) {
          stream
            .getTracks()
            .forEach(
              (track) =>
                track.stop()
            );

          return;
        }

        const video =
          videoRef.current;

        if (!video) return;

        video.srcObject =
          stream;

        await video.play();

        setStatus(
          "AI SYSTEM ONLINE"
        );

        /*
         * ==============================
         * RENDER LOOP
         * ==============================
         */

        function render() {
          const video =
            videoRef.current;

          const canvas =
            canvasRef.current;

          if (
            !video ||
            !canvas
          ) {
            animationFrameRef.current =
              requestAnimationFrame(
                render
              );

            return;
          }

          if (
            video.readyState >=
              2 &&
            video.currentTime !==
              lastVideoTimeRef.current
          ) {
            canvas.width =
              video.videoWidth;

            canvas.height =
              video.videoHeight;

            const ctx =
              canvas.getContext(
                "2d"
              );

            if (!ctx) {
              animationFrameRef.current =
                requestAnimationFrame(
                  render
                );

              return;
            }

            ctx.clearRect(
              0,
              0,
              canvas.width,
              canvas.height
            );

            /*
             * ==============================
             * HAND DETECTION
             * ==============================
             */

            const result =
              handLandmarker.detectForVideo(
                video,
                performance.now()
              );

            const detectedHands =
              result.landmarks.length;

            setHandCount(
              detectedHands
            );

            const allLandmarks =
              result.landmarks.flat();

            if (
              allLandmarks.length >
              0
            ) {
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
                (minX +
                  maxX) /
                2;

              const centerY =
                (minY +
                  maxY) /
                2;

              /*
               * 데이터 수집과
               * 동일한 Crop
               */
              const multiplier =
                detectedHands >= 2
                  ? 1.55
                  : 1.7;

              let size =
                Math.max(
                  width,
                  height
                ) *
                multiplier;

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
                centerX -
                size / 2;

              let y =
                centerY -
                size / 2;

              x = Math.max(
                0,
                Math.min(
                  x,
                  canvas.width -
                    size
                )
              );

              y = Math.max(
                0,
                Math.min(
                  y,
                  canvas.height -
                    size
                )
              );

              let nextCrop: CropBox =
                {
                  x,
                  y,
                  size,
                };

              /*
               * 두 손 Crop 기억
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
               * 손 겹침 때문에 1손으로
               * 잠깐 떨어지면 이전 Crop 유지
               */
              if (
                detectedHands ===
                  1 &&
                lastTwoHandCropRef.current &&
                performance.now() -
                  lastTwoHandTimeRef.current <
                  900
              ) {
                nextCrop =
                  lastTwoHandCropRef.current;
              }

              const finalCrop =
                smoothCrop(
                  nextCrop
                );

              cropRef.current =
                finalCrop;

              /*
               * AI Crop 영역
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
               * ==============================
               * HAND SKELETON
               * ==============================
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
               * ==============================
               * PREDICTION
               * ==============================
               *
               * 약 350ms마다
               */
              const now =
                performance.now();

              if (
                now -
                  lastPredictionTimeRef.current >
                350
              ) {
                lastPredictionTimeRef.current =
                  now;

                void runPrediction();
              }
            } else {
              /*
               * ==============================
               * NO HAND
               * ==============================
               */

              cropRef.current =
                null;

              smoothedCropRef.current =
                null;

              lastTwoHandCropRef.current =
                null;

              setPrediction(null);

              /*
               * 손을 내리면
               * 다음 술법을 위해 confirmation reset
               */
              predictionHistoryRef.current =
                [];

              setConfirmProgress(0);

              setSealConfirmed(
                false
              );
            }

            /*
             * ==============================
             * SHADOW CLONE VFX
             * ==============================
             *
             * 술법이 발동 중일 때만
             * Person Segmentation 실행
             */
            const now =
              performance.now();

            if (
              jutsuActiveRef.current &&
              now -
                lastSegmentationTimeRef.current >
                100
            ) {
              lastSegmentationTimeRef.current =
                now;

              runCloneSegmentation(
                imageSegmenter
              );
            }

            /*
             * 술법이 끝났으면
             * clone canvas 제거
             */
            if (
              !jutsuActiveRef.current
            ) {
              const cloneCanvas =
                cloneCanvasRef.current;

              if (cloneCanvas) {
                const cloneCtx =
                  cloneCanvas.getContext(
                    "2d"
                  );

                if (cloneCtx) {
                  cloneCtx.clearRect(
                    0,
                    0,
                    cloneCanvas.width,
                    cloneCanvas.height
                  );
                }
              }
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
          .forEach(
            (track) =>
              track.stop()
          );
      }
    };
  }, []);

  /*
   * ==============================
   * ACTIVE LEARNING CORRECTION
   * ==============================
   */

  async function saveCorrection(
    label:
      | "shadow_clone"
      | "none"
  ) {
    const blob =
      latestAiBlobRef.current;

    if (!blob) {
      setCorrectionStatus(
        "NO AI FRAME AVAILABLE"
      );

      return;
    }

    if (
      isSavingCorrection
    ) {
      return;
    }

    try {
      setIsSavingCorrection(
        true
      );

      setCorrectionStatus(
        `SAVING AS ${label.toUpperCase()}...`
      );

      const formData =
        new FormData();

      formData.append(
        "label",
        label
      );

      formData.append(
        "image",
        blob,
        `${label}.jpg`
      );

      const response =
        await fetch(
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

      const data =
        await response.json();

      setCorrectionStatus(
        `SAVED AS ${label.toUpperCase()} · TOTAL ${data.count}`
      );
    } catch (error) {
      console.error(error);

      setCorrectionStatus(
        "FAILED TO SAVE CORRECTION"
      );
    } finally {
      setIsSavingCorrection(
        false
      );
    }
  }

  /*
   * ==============================
   * UI VALUES
   * ==============================
   */

  const shadowProbability =
    prediction
      ?.shadow_clone_probability ??
    0;

  const noneProbability =
    prediction
      ?.none_probability ?? 0;

  const shadowPercent =
    Math.round(
      shadowProbability * 100
    );

  const nonePercent =
    Math.round(
      noneProbability * 100
    );

  /*
   * 실시간 단일 Frame 표시용
   */
  const currentSeal =
    !prediction
      ? "WAITING"
      : shadowProbability >=
          0.55
        ? "SHADOW CLONE"
        : shadowProbability <=
            0.35
          ? "NONE"
          : "UNCERTAIN";

  const sealDetected =
    sealConfirmed;

  /*
   * ==============================
   * UI
   * ==============================
   */

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <style>{`
        @keyframes ninjaSmoke {
          0% {
            opacity: 0;
            transform: scale(0.3);
          }

          25% {
            opacity: 0.95;
          }

          100% {
            opacity: 0;
            transform: scale(2.4);
          }
        }

        @keyframes jutsuTitle {
          0% {
            opacity: 0;
            transform: scale(1.45);
            filter: blur(8px);
          }

          25% {
            opacity: 1;
            transform: scale(1);
            filter: blur(0px);
          }

          75% {
            opacity: 1;
            transform: scale(1);
          }

          100% {
            opacity: 0;
            transform: scale(0.95);
          }
        }
      `}</style>

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
          {/* ==========================
              CAMERA
          ========================== */}
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
            {/* ORIGINAL CAMERA */}
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

            {/* SHADOW CLONES */}
            <canvas
              ref={cloneCanvasRef}
              className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
              style={{
                transform:
                  "scaleX(-1)",
              }}
            />

            {/* HAND TRACKING */}
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 z-20 h-full w-full"
              style={{
                transform:
                  "scaleX(-1)",
              }}
            />

            {/* HAND STATUS */}
            <div className="absolute left-4 top-4 z-30 rounded-xl bg-black/70 px-4 py-3 backdrop-blur">
              <p className="text-xs text-zinc-500">
                HAND TRACKING
              </p>

              <p className="font-mono text-green-400">
                {handCount === 0
                  ? "NO HAND"
                  : `${handCount} HAND${
                      handCount >
                      1
                        ? "S"
                        : ""
                    } DETECTED`}
              </p>
            </div>

            {/* JUTSU ACTIVE BADGE */}
            {jutsuActive && (
              <div className="absolute right-4 top-4 z-30 rounded-xl border border-yellow-400/50 bg-black/80 px-4 py-3 backdrop-blur">
                <p className="text-xs tracking-[0.2em] text-zinc-500">
                  NINJUTSU
                </p>

                <p className="font-mono font-bold text-yellow-400">
                  ACTIVE
                </p>
              </div>
            )}

            {/* FLASH */}
            {flashActive && (
              <div className="pointer-events-none absolute inset-0 z-50 bg-white/90" />
            )}

            {/* SMOKE */}
            {smokeActive && (
              <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
                <div
                  className="absolute bottom-[5%] left-[7%] h-40 w-40 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(210,210,210,0.75) 35%, rgba(140,140,140,0.25) 65%, transparent 75%)",

                    filter:
                      "blur(10px)",

                    animation:
                      "ninjaSmoke 1.4s ease-out forwards",
                  }}
                />

                <div
                  className="absolute bottom-[12%] left-[41%] h-44 w-44 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(210,210,210,0.75) 35%, rgba(140,140,140,0.25) 65%, transparent 75%)",

                    filter:
                      "blur(12px)",

                    animation:
                      "ninjaSmoke 1.25s ease-out forwards",
                  }}
                />

                <div
                  className="absolute bottom-[5%] right-[7%] h-40 w-40 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(210,210,210,0.75) 35%, rgba(140,140,140,0.25) 65%, transparent 75%)",

                    filter:
                      "blur(10px)",

                    animation:
                      "ninjaSmoke 1.4s ease-out forwards",
                  }}
                />
              </div>
            )}

            {/* JUTSU NAME */}
            {jutsuTextVisible && (
              <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center">
                <div
                  className="text-center"
                  style={{
                    animation:
                      "jutsuTitle 1.8s ease-out forwards",
                  }}
                >
                  <p
                    className="text-5xl font-black text-white md:text-7xl"
                    style={{
                      textShadow:
                        "0 0 12px #000, 0 0 30px rgba(250,204,21,0.9)",
                    }}
                  >
                    影分身の術
                  </p>

                  <p
                    className="mt-3 text-lg font-black tracking-[0.35em] text-yellow-400 md:text-2xl"
                    style={{
                      textShadow:
                        "0 0 10px #000",
                    }}
                  >
                    SHADOW CLONE JUTSU
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ==========================
              RIGHT PANEL
          ========================== */}
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
                className={`mt-2 font-mono text-lg font-bold ${
                  sealDetected
                    ? "text-yellow-400"
                    : currentSeal ===
                        "SHADOW CLONE"
                      ? "text-orange-400"
                      : "text-green-400"
                }`}
              >
                {sealDetected
                  ? "SEAL CONFIRMED"
                  : currentSeal ===
                      "SHADOW CLONE"
                    ? "VERIFYING..."
                    : "STANDBY"}
              </p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    sealDetected
                      ? "bg-yellow-400"
                      : "bg-orange-400"
                  }`}
                  style={{
                    width: `${confirmProgress}%`,
                  }}
                />
              </div>

              <p className="mt-2 font-mono text-xs text-zinc-500">
                CONFIRMATION{" "}
                {confirmProgress}%
              </p>

              {/* JUTSU STATE */}
              <div className="mt-4 rounded-xl bg-black px-4 py-3">
                <p className="text-xs text-zinc-500">
                  JUTSU VFX
                </p>

                <p
                  className={`mt-1 font-mono text-sm font-bold ${
                    jutsuActive
                      ? "text-yellow-400"
                      : "text-zinc-500"
                  }`}
                >
                  {jutsuActive
                    ? "SHADOW CLONES ACTIVE"
                    : "STANDBY"}
                </p>
              </div>
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
                  ref={
                    aiPreviewRef
                  }
                  width={320}
                  height={320}
                  className="h-full w-full object-cover"
                />
              </div>

              <p className="mt-2 text-xs leading-5 text-zinc-500">
                모델이 실제로
                판별하고 있는
                이미지입니다.
              </p>

              {/* CORRECT AI */}
              <div className="mt-5 border-t border-zinc-800 pt-5">
                <p className="text-xs tracking-[0.2em] text-zinc-500">
                  CORRECT AI
                </p>

                <p className="mt-2 text-xs leading-5 text-zinc-500">
                  AI가 틀렸다면 마지막
                  AI VIEW를 올바른
                  라벨로 저장하세요.
                </p>

                <button
                  onClick={() =>
                    saveCorrection(
                      "shadow_clone"
                    )
                  }
                  disabled={
                    !hasAiSample ||
                    isSavingCorrection
                  }
                  className="mt-4 w-full rounded-xl bg-yellow-400 px-4 py-3 text-sm font-bold text-black disabled:opacity-30"
                >
                  ADD AS SHADOW
                  CLONE
                </button>

                <button
                  onClick={() =>
                    saveCorrection(
                      "none"
                    )
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
                    {
                      correctionStatus
                    }
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