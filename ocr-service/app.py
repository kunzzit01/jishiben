"""jishiben 服务端 OCR 微服务。

本机 ML Kit 对「手写发票 / 热敏纸 / 反光照片」识别差，这里用 RapidOCR
（PaddleOCR PP-OCR 的 ONNX 版，pip 包名 rapidocr_onnxruntime）做兜底。

硬边界：只返回文字与像素坐标，不做任何业务判断（金额/日期解析仍在客户端），
避免服务端与客户端两套解析逻辑漂移。

接口：
    GET  /ocr/health            -> 引擎与版本（无需密钥，不触发模型加载）
    POST /ocr/lines  (multipart) -> {"lines": [...], "avgScore": ..., "elapsedMs": ...}

错误统一为 {"code": "...", "message": "..."}。
"""

from __future__ import annotations

import asyncio
import hmac
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from importlib import metadata

import numpy as np  # rapidocr_onnxruntime 的传递依赖，不额外引入
from fastapi import APIRouter, Depends, FastAPI, File, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from PIL import Image
from starlette.exceptions import HTTPException as StarletteHTTPException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("jishiben.ocr")

# ── 限制 ────────────────────────────────────────────────────────────────────
MAX_BYTES = 8 * 1024 * 1024  # 上传上限 8MB
MAX_SIDE = 2000  # 解码后最长边上限：超出先缩小再识别，控内存
MAX_CONCURRENCY = 2  # 同时进识别的请求数上限
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
# 部分 RN 上传默认发 octet-stream：放行后由 Pillow 按真实字节校验
LAX_MIME = ALLOWED_MIME | {"application/octet-stream", "image/jpg", ""}

OCR_SHARED_KEY = os.environ.get("OCR_SHARED_KEY", "")

_STATUS_BY_CODE = {
    "BAD_IMAGE": 400,
    "TOO_LARGE": 413,
    "UNAUTHORIZED": 401,
    "NOT_FOUND": 404,
    "ENGINE_ERROR": 500,
}


class OCRError(Exception):
    """业务错误：由异常处理器统一转成 {"code","message"} JSON。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ── 引擎单例 ────────────────────────────────────────────────────────────────
# 首次调用要加载 onnx 模型（数秒），之后复用同一实例；用锁避免并发首调加载多次。
_engine = None
_engine_lock = threading.Lock()
# 单进程内限制并发；多 worker 会各自持有一份模型，故 Dockerfile 固定 --workers 1
_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)


def _get_engine():
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                started = time.monotonic()
                _engine = RapidOCR()
                logger.info(
                    "rapidocr engine loaded in %dms", int((time.monotonic() - started) * 1000)
                )
    return _engine


def _engine_version() -> str:
    try:
        return metadata.version("rapidocr_onnxruntime")
    except metadata.PackageNotFoundError:  # pragma: no cover - 仅在装坏了时发生
        return "unknown"


# ── 识别 ────────────────────────────────────────────────────────────────────
def _decode(raw: bytes) -> tuple[Image.Image, int, int]:
    """解码 + 限制最长边，返回 (RGB 图, 原图宽, 原图高)。

    JPEG 走 draft() 在解码阶段就降采样，避免先把超大图整张解到内存里。
    """
    try:
        img = Image.open(io.BytesIO(raw))
        orig_w, orig_h = img.size  # 读头部即得，无需完整解码
        if img.format == "JPEG":
            img.draft("RGB", (MAX_SIDE, MAX_SIDE))
        img.load()
    except Exception as exc:  # noqa: BLE001 - 任何解码失败都归为坏图
        raise OCRError("BAD_IMAGE", "无法解码图片，仅支持 jpeg/png/webp") from exc

    if img.mode in ("RGBA", "LA", "P"):
        # 透明 PNG 直接丢 alpha 会留下奇怪底色，先压到白底上再识别
        rgba = img.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        img = canvas
    elif img.mode != "RGB":
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > MAX_SIDE:
        ratio = MAX_SIDE / float(longest)
        # 至少 1px，且不让宽/高互相覆盖成 0
        img = img.resize(
            (max(1, int(round(img.size[0] * ratio))), max(1, int(round(img.size[1] * ratio)))),
            Image.LANCZOS,
        )
    return img, orig_w, orig_h


def _recognize_sync(raw: bytes) -> dict:
    """同步识别（在线程池里跑，不阻塞事件循环）。坐标为原图像素。"""
    started = time.monotonic()
    img, orig_w, orig_h = _decode(raw)
    work_w, work_h = img.size
    # 缩小识别后把框按比例还原到原图像素空间，客户端才能直接和原图做版面配对
    scale_x = orig_w / float(work_w)
    scale_y = orig_h / float(work_h)

    try:
        result, _elapse = _get_engine()(np.asarray(img))
    except OCRError:
        raise
    except Exception as exc:  # noqa: BLE001 - 推理异常统一暴露为 500，不泄露内部细节
        logger.exception("rapidocr inference failed")
        raise OCRError("ENGINE_ERROR", "OCR 引擎识别失败") from exc

    lines = []
    scores = []
    for item in result or []:
        try:
            box, text, score = item[0], item[1], item[2]
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
        except (IndexError, TypeError, ValueError):
            continue  # 单条结果形状异常就跳过，不让整张图失败

        text = (text or "").strip()
        if not text:
            continue

        left = min(xs)
        top = min(ys)
        # 先缩放回原图再取整：宽高由右上/左下角推得，避免两次取整误差叠加
        left_i = int(round(left * scale_x))
        top_i = int(round(top * scale_y))
        right_i = int(round(max(xs) * scale_x))
        bottom_i = int(round(max(ys) * scale_y))

        lines.append(
            {
                "text": text,
                "top": max(0, min(orig_h, top_i)),
                "left": max(0, min(orig_w, left_i)),
                "width": max(0, right_i - left_i),
                "height": max(0, bottom_i - top_i),
                "score": round(float(score), 4),
            }
        )
        scores.append(float(score))

    lines.sort(key=lambda line: (line["top"], line["left"]))
    return {
        "lines": lines,
        "avgScore": round(sum(scores) / len(scores), 4) if scores else 0.0,
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }


# ── 请求校验 ────────────────────────────────────────────────────────────────
async def require_key(x_ocr_key: str | None = Header(default=None)) -> None:
    """校验共享密钥头 X-OCR-Key。未配置密钥时一律拒绝，绝不退化成开放接口。"""
    if not OCR_SHARED_KEY:
        logger.error("OCR_SHARED_KEY is empty; rejecting request")
        raise OCRError("ENGINE_ERROR", "服务端未配置共享密钥")
    provided = (x_ocr_key or "").encode("utf-8")
    expected = OCR_SHARED_KEY.encode("utf-8")
    if not provided or not hmac.compare_digest(provided, expected):
        raise OCRError("UNAUTHORIZED", "X-OCR-Key 缺失或无效")


async def _read_limited(file: UploadFile) -> bytes:
    """按块读并累计判大小：不信 Content-Length，超限立刻停。"""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise OCRError("TOO_LARGE", f"图片超过 {MAX_BYTES // (1024 * 1024)}MB 上限")
        chunks.append(chunk)
    if total == 0:
        raise OCRError("BAD_IMAGE", "上传文件为空")
    return b"".join(chunks)


# ── 路由 ────────────────────────────────────────────────────────────────────
router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """健康检查不触发模型加载，容器探活可以高频打。"""
    return {
        "status": "ok",
        "engine": "rapidocr",
        "version": _engine_version(),
        "engineLoaded": _engine is not None,
    }


@router.post("/lines")
async def ocr_lines(
    file: UploadFile = File(...),
    _: None = Depends(require_key),
) -> dict:
    started = time.monotonic()

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in LAX_MIME:
        raise OCRError("BAD_IMAGE", f"不支持的 Content-Type: {content_type or 'empty'}")

    raw = await _read_limited(file)

    # 信号量覆盖「解码 + 识别」整段，真正压住 CPU 与内存峰值
    async with _semaphore:
        payload = await asyncio.to_thread(_recognize_sync, raw)

    payload["elapsedMs"] = int((time.monotonic() - started) * 1000)
    # 只记字节数与耗时，绝不打印图片内容或识别文本
    logger.info(
        "ocr ok bytes=%d lines=%d avgScore=%.3f elapsedMs=%d",
        len(raw),
        len(payload["lines"]),
        payload["avgScore"],
        payload["elapsedMs"],
    )
    return payload


# ── 应用装配 ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def _lifespan(_: FastAPI):
    if not OCR_SHARED_KEY:
        logger.error("OCR_SHARED_KEY 未设置：/ocr/lines 将全部拒绝，仅健康检查可用")
    yield


app = FastAPI(
    title="jishiben OCR",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    lifespan=_lifespan,
)

# 生产路径：nginx 把 /ocr/ 原样转发过来（保留前缀）
app.include_router(router, prefix="/ocr")
# 直连容器调试用同一套路由（curl http://127.0.0.1:8090/health）
app.include_router(router, include_in_schema=False)


@app.exception_handler(OCRError)
async def _ocr_error_handler(_: Request, exc: OCRError) -> JSONResponse:
    return JSONResponse(
        status_code=_STATUS_BY_CODE.get(exc.code, 500),
        content={"code": exc.code, "message": exc.message},
    )


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # 缺 file 字段等：客户端按 BAD_IMAGE 处理即可
    return JSONResponse(status_code=400, content={"code": "BAD_IMAGE", "message": "缺少 file 字段"})


@app.exception_handler(StarletteHTTPException)
async def _http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = "NOT_FOUND" if exc.status_code == 404 else "BAD_IMAGE"
    return JSONResponse(status_code=exc.status_code, content={"code": code, "message": str(exc.detail)})


@app.exception_handler(Exception)
async def _unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error")
    return JSONResponse(status_code=500, content={"code": "ENGINE_ERROR", "message": "服务内部错误"})
