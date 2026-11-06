# 服务端 OCR 兜底：RapidOCR（PaddleOCR PP-OCR 的 ONNX 版）
# 由 deploy/docker-compose.yml 的 ocr 服务调用：
#   context: ../ocr-service   dockerfile: Dockerfile
#
# 只用 python:3.11-slim 官方镜像；模型不在构建期下载（见 README「模型从哪来」）。

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=UTC

# rapidocr 的传递依赖 opencv-python 在 import 时需要 libGL / libglib，
# onnxruntime 需要 libgomp；缺任何一个都会在启动阶段直接
# ImportError: libGL.so.1: cannot open shared object file。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖层单独 COPY：只有 requirements 变了才重装（装完约 300MB，最慢的一层）
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# 以非 root 运行。HOME 必须可写：若日后升级到会自己下模型的 rapidocr 版本，
# 权重会落到 ~/.cache 下，只读 HOME 会让首次调用失败。
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin ocr \
    && chown -R 10001:10001 /app
USER 10001:10001
ENV HOME=/home/ocr

EXPOSE 8090

# 探活只打健康检查，不触发模型加载（首次识别时才加载，见 README）
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/ocr/health', timeout=3).status == 200 else 1)"

# 固定单 worker：模型是进程内单例，多 worker 会各复制一份（内存翻倍且首调重复变慢）
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
