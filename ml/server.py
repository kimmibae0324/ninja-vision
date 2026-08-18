from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from keras.models import load_model


# =========================
# Paths / Settings
# =========================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_PATH = (
    PROJECT_ROOT
    / "models"
    / "shadow_clone_classifier.keras"
)

IMAGE_SIZE = (160, 160)

THRESHOLD = 0.5


# =========================
# Load model
# =========================

print("=" * 60)
print("🥷 NINJA VISION AI SERVER")
print("=" * 60)

print(f"Loading model:")
print(MODEL_PATH)

model = load_model(
    MODEL_PATH,
    compile=False,
)

print("✅ Model loaded")


# =========================
# FastAPI
# =========================

app = FastAPI(
    title="Ninja Vision AI",
    version="0.1.0",
)


# Next.js 개발 서버 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# Health Check
# =========================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "shadow_clone_classifier",
    }


# =========================
# Prediction
# =========================

@app.post("/predict")
async def predict(
    image: UploadFile = File(...)
):
    image_bytes = await image.read()

    pil_image = Image.open(
        BytesIO(image_bytes)
    ).convert("RGB")

    pil_image = pil_image.resize(
        IMAGE_SIZE
    )

    image_array = np.asarray(
        pil_image,
        dtype=np.float32,
    )

    # batch dimension 추가
    image_array = np.expand_dims(
        image_array,
        axis=0,
    )

    # 우리가 저장한 Keras 모델 내부에
    # MobileNetV2 preprocess_input 레이어가
    # 이미 들어 있으므로 여기서는
    # 0~255 RGB 값 그대로 전달한다.

    
    prediction = model.predict(
        image_array,
        verbose=0,
    )

    shadow_probability = float(
        prediction[0][0]
    )

    none_probability = (
        1.0 - shadow_probability
    )

    if shadow_probability >= THRESHOLD:
        label = "shadow_clone"
        confidence = shadow_probability
    else:
        label = "none"
        confidence = none_probability

    return {
        "label": label,

        "confidence": round(
            confidence,
            4,
        ),

        "shadow_clone_probability": round(
            shadow_probability,
            4,
        ),

        "none_probability": round(
            none_probability,
            4,
        ),
    }