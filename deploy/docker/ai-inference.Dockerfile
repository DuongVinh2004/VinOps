# ==============================================================================
# VinOps Construction AI & Computer Vision Inference Microservice
# Base: Python 3.11 Slim (Optimized for fast cold start < 5s, image size < 1.2GB)
# Endpoints: POST /predict, GET /healthz
# ==============================================================================

FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY <<EOF /app/requirements.txt
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
onnxruntime>=1.19.0
pillow>=10.4.0
numpy>=1.26.0
pydantic>=2.8.0
EOF

RUN pip install --user -r requirements.txt

# Final Runtime Image
FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    MODEL_PATH=/app/models/yolov11-construction.onnx \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local

# Copy application script
COPY <<EOF /app/main.py
import os
import time
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="VinOps AI Vision Inference Service", version="1.2.0")

class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float

class Detection(BaseModel):
    type: str
    confidence: float
    bbox: BoundingBox
    metadata: Optional[dict] = None

class PredictionRequest(BaseModel):
    fileId: str
    modelName: Optional[str] = "yolov11-construction-v1"

class PredictionResponse(BaseModel):
    detections: List[Detection]
    model_name: str
    model_version: str
    processing_time_ms: int

@app.get("/healthz")
async def healthz():
    return {"status": "ok", "service": "vinops-ai-inference", "model": "yolov11-v1"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(req: PredictionRequest):
    start = time.time()
    # Simulated high-speed ONNX runtime defect inference
    mock_detections = [
        Detection(
            type="honeycombing",
            confidence=0.9125,
            bbox=BoundingBox(x=0.354, y=0.421, width=0.185, height=0.22),
            metadata={"estimatedAreaCm2": 450.0, "severityGrade": "major"}
        ),
        Detection(
            type="rebar_exposure",
            confidence=0.742,
            bbox=BoundingBox(x=0.41, y=0.58, width=0.082, height=0.115),
            metadata={"barCountEstimate": 2}
        )
    ]
    duration_ms = int((time.time() - start) * 1000)
    return PredictionResponse(
        detections=mock_detections,
        model_name="yolov11-construction-v1",
        model_version="1.2.0",
        processing_time_ms=max(1, duration_ms)
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
EOF

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
