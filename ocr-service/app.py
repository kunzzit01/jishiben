"""jishiben 服务端 OCR 微服务。

本机 ML Kit 对「手写发票 / 热敏纸 / 反光照片」识别差，这里用 RapidOCR
（PaddleOCR PP-OCR 的 ONNX 版，pip 包名 rapidocr_onnxruntime）做兜底。

硬边界：只返回文字与像素坐标，不做任何业务判断（金额/日期解析仍在客户端），
避免服务端与客户端两套解析逻辑漂移。

接口：
    GET  /ocr/health            -> 引擎与版本（无需密钥，不触发模型加载）
    POST /ocr/lines  (multipart) -> {"lines": [...], "avgScore": ..., "elapsedMs": ...,
                                     "passes": 1|2, "warnings": [...], "crop": null|{...}}

合计区域重读：首轮识别后做一次版面判断，命中合计标签行、但标签附近（同一行右侧 /
上下相邻两行）没有任何「像金额」的字串时，按标签位置裁一块图再识别一次（每请求最多
一次），二次结果映射回原图坐标后并入 lines。没有触发时 crop 为 null。

错误统一为 {"code": "...", "message": "..."}。
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import httpx
import io
import logging
import math
import os
import re
import threading
import time
import unicodedata
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


def _env_int(name: str, default: int) -> int:
    """读正整数环境变量；值不合法只告警并回落，绝不让服务在 import 期崩掉。"""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("环境变量 %s=%r 不是整数，回落到 %d", name, raw, default)
        return default
    if value <= 0:
        logger.warning("环境变量 %s=%r 不是正数，回落到 %d", name, raw, default)
        return default
    return value


# ── 限制 ────────────────────────────────────────────────────────────────────
MAX_BYTES = 8 * 1024 * 1024  # 上传上限 8MB
MAX_SIDE = 2000  # 解码后最长边上限：超出先缩小再识别，控内存
MAX_CONCURRENCY = 2  # 同时进识别的请求数上限
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
# 部分 RN 上传默认发 octet-stream：放行后由 Pillow 按真实字节校验
LAX_MIME = ALLOWED_MIME | {"application/octet-stream", "image/jpg", ""}

# ── 合计区域二次识别的参数 ──────────────────────────────────────────────────
CROP_PAD_Y_RATIO = 1.5  # 标签框上下各外扩 1.5 倍行高
CROP_PAD_X_RATIO = 0.40  # 标签框左右各外扩 40% 图宽
SAME_ROW_OVERLAP = 0.5  # 垂直重叠 ≥ 50% 行高即算「同一行」
ADJACENT_GAP_RATIO = 2.0  # 与标签行的垂直空隙 ≤ 2 倍行高即算「上下相邻两行」
SECOND_PASS_MIN_MS = 800  # 剩余预算低于此值就不开第二次推理（起推理本身也要时间）
DEFAULT_TOTAL_BUDGET_MS = 15000

# 两次推理共享的总时限：从收到请求（含排队）算起，超了就放弃二次识别
TOTAL_BUDGET_MS = _env_int("OCR_TOTAL_BUDGET_MS", DEFAULT_TOTAL_BUDGET_MS)

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


# ── 合计区域版面判断（纯函数：只吃 lines 与图片尺寸，不碰 PIL / 引擎） ──────
def _norm(text: str) -> str:
    """NFKC 折全角 + 转小写 + 压空白，让 ＴＯＴＡＬ / 总  额 这类变体也能命中。"""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text or "")).strip().lower()


# 顺序有意义：先匹配更具体的写法，GRAND TOTAL 不会被降级成 TOTAL
_TOTAL_LABEL_RULES = (
    ("GRAND TOTAL", re.compile(r"\bgrand\s*total\b")),
    ("AMOUNT DUE", re.compile(r"\bamount\s*due\b")),
    ("JUMLAH", re.compile(r"\bjumlah\b")),
    ("TOTAL", re.compile(r"\btotal\b")),
    ("总额", re.compile(r"总额|總額|总金额|總金額|总计|總計")),
    ("合计", re.compile(r"合计|合計")),
)

# 小计行不算合计行：SUBTOTAL / Sub Total 都不该触发重读
_SUBTOTAL_RE = re.compile(r"\bsub[\s\-]*total\b")

# 「像金额」的简单规则（判定只看字面，不做业务解析）：
# 1–3 位小数（含印尼千分位 25.000）、88/= 手写写法、88,- / 88- 写法、整行就是一个数字
_AMOUNT_PATTERNS = (
    re.compile(r"\d+[.,]\d{1,3}"),
    re.compile(r"\d+/="),
    re.compile(r"\d+,?-$"),
    re.compile(r"^(?:rp\.?|idr|rm|\$|¥|€)?\d{1,9}(?:[.,]\d{3})*(?:[.,]\d{1,3})?$"),
)


def match_total_label(text: str) -> str | None:
    """命中合计标签时返回规范化的标签名（如 "TOTAL" / "总额"），否则 None。"""
    norm = _norm(text)
    if not norm:
        return None
    compact = norm.replace(" ", "")  # 中文票据常被识别成「总 额」
    if _SUBTOTAL_RE.search(norm) or _SUBTOTAL_RE.search(compact):
        return None  # 小计行：标签命中也要放弃
    for name, pattern in _TOTAL_LABEL_RULES:
        if pattern.search(norm) or pattern.search(compact):
            return name
    return None


def looks_like_amount(text: str) -> bool:
    """粗略判断一段字串像不像金额；宁可多报（多报只是少做一次优化）。"""
    norm = _norm(text).replace(" ", "")
    if not norm:
        return False
    return any(pattern.search(norm) for pattern in _AMOUNT_PATTERNS)


def _row_overlap_ratio(a: dict, b: dict) -> float:
    """垂直重叠占较矮一行的比例；同一行约等于 1。"""
    top = max(a["top"], b["top"])
    bottom = min(a["top"] + a["height"], b["top"] + b["height"])
    shorter = min(max(1, a["height"]), max(1, b["height"]))
    return max(0.0, bottom - top) / float(shorter)


def _row_gap(a: dict, b: dict) -> float:
    """两框之间的垂直空隙；同一行或已重叠时为 0。"""
    return max(0.0, b["top"] - (a["top"] + a["height"]), a["top"] - (b["top"] + b["height"]))


def label_has_amount_nearby(label: dict, lines: list[dict]) -> bool:
    """标签行自身、同一行右侧、或上下相邻两行内是否已有「像金额」的字串。"""
    if looks_like_amount(label["text"]):
        return True  # 引擎可能把「TOTAL 88.00」并进同一行
    center_x = label["left"] + label["width"] / 2.0
    max_gap = ADJACENT_GAP_RATIO * max(1, label["height"])
    for other in lines:
        if other is label or not looks_like_amount(other["text"]):
            continue
        if _row_overlap_ratio(label, other) >= SAME_ROW_OVERLAP:
            if other["left"] + other["width"] / 2.0 > center_x:
                return True  # 同一行且落在标签右侧
        elif _row_gap(label, other) <= max_gap:
            return True  # 上下相邻两行（含字迹比标签行更高的情况）
    return False


def _expand_box(label: dict, img_w: int, img_h: int) -> dict:
    """标签框外扩成裁框：上下各 1.5 倍行高、左右各 40% 图宽，越界时整体平移回图内。

    越界用「平移」而不是「裁切」：保持裁框尺寸不变，只是把它推回票据范围内。
    """
    pad_x = CROP_PAD_X_RATIO * img_w
    pad_y = CROP_PAD_Y_RATIO * max(1, label["height"])
    width = min(float(img_w), label["width"] + 2.0 * pad_x)
    height = min(float(img_h), max(1, label["height"]) + 2.0 * pad_y)
    left = min(max(0.0, label["left"] - pad_x), img_w - width)
    top = min(max(0.0, label["top"] - pad_y), img_h - height)
    left_i = int(round(left))
    top_i = int(round(top))
    width_i = max(1, min(int(round(width)), img_w - left_i))
    height_i = max(1, min(int(round(height)), img_h - top_i))
    return {"top": top_i, "left": left_i, "width": width_i, "height": height_i}


def plan_crop(lines: list[dict], img_w: int, img_h: int) -> tuple[str | None, dict | None]:
    """版面判断：命中合计标签且附近没金额 -> (标签名, 原图裁框)；否则 (None, None)。"""
    for label in lines:
        name = match_total_label(label["text"])
        if not name or label_has_amount_nearby(label, lines):
            continue  # 不是合计标签，或金额已经配到了，不必重读
        return name, _expand_box(label, img_w, img_h)
    return None, None


def _iou(a: dict, b: dict) -> float:
    inter_w = min(a["left"] + a["width"], b["left"] + b["width"]) - max(a["left"], b["left"])
    inter_h = min(a["top"] + a["height"], b["top"] + b["height"]) - max(a["top"], b["top"])
    if inter_w <= 0 or inter_h <= 0:
        return 0.0
    inter = inter_w * inter_h
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / float(union) if union > 0 else 0.0


def merge_lines(primary: list[dict], secondary: list[dict]) -> list[dict]:
    """把二次识别结果并进首轮：同一块区域被读到两次时只留首轮那条，最后按 (top,left) 排序。"""
    merged = list(primary)
    for line in secondary:
        if any(
            _iou(line, kept) >= 0.5
            or (_norm(line["text"]) == _norm(kept["text"]) and _iou(line, kept) >= 0.2)
            for kept in merged
        ):
            continue
        merged.append(line)
    merged.sort(key=_sort_key)
    return merged


def _sort_key(line: dict) -> tuple[int, int]:
    return line["top"], line["left"]


def _avg_score(lines: list[dict]) -> float:
    return round(sum(line["score"] for line in lines) / len(lines), 4) if lines else 0.0


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


def _fit_for_infer(patch: Image.Image) -> tuple[Image.Image, float]:
    """裁图若还超过最长边上限，先缩一次；返回 (送进引擎的图, 裁图像素/送入像素)。"""
    longest = max(patch.size)
    if longest <= MAX_SIDE:
        return patch, 1.0
    ratio = MAX_SIDE / float(longest)
    resized = patch.resize(
        (max(1, int(round(patch.size[0] * ratio))), max(1, int(round(patch.size[1] * ratio)))),
        Image.LANCZOS,
    )
    return resized, patch.size[0] / float(resized.size[0])


def _run_engine(img: Image.Image) -> list:
    """跑一次推理，返回 RapidOCR 的原始结果（box, text, score）。"""
    try:
        result, _elapse = _get_engine()(np.asarray(img))
    except OCRError:
        raise
    except Exception as exc:  # noqa: BLE001 - 推理异常统一暴露为 500，不泄露内部细节
        logger.exception("rapidocr inference failed")
        raise OCRError("ENGINE_ERROR", "OCR 引擎识别失败") from exc
    return result or []


def _collect_lines(
    result: list, ax: float, bx: float, ay: float, by: float, orig_w: int, orig_h: int
) -> list[dict]:
    """引擎原始结果 -> 原图像素的行 dict。

    坐标还原公式（x 用 ax/bx，y 用 ay/by）：
        原图坐标 = 引擎坐标 × 比例 + 原点偏移
    首轮：比例 = 工作图→原图，偏移 = 0；
    二次：比例 = 裁图内部缩放 × 工作图→原图，偏移 = 裁框左上角（已换算到原图坐标）。
    """
    lines: list[dict] = []
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

        # 先乘比例再加偏移，最后才取整：减少两次取整的误差叠加
        # 左/上先夹进图内再推宽高，保证 left+width 不会因为负偏移冲出原图
        left_i = max(0, min(orig_w, int(round(min(xs) * ax + bx))))
        top_i = max(0, min(orig_h, int(round(min(ys) * ay + by))))
        right_i = max(left_i, min(orig_w, int(round(max(xs) * ax + bx))))
        bottom_i = max(top_i, min(orig_h, int(round(max(ys) * ay + by))))

        lines.append(
            {
                "text": text,
                "top": top_i,
                "left": left_i,
                "width": right_i - left_i,
                "height": bottom_i - top_i,
                "score": round(float(score), 4),
            }
        )
    return lines


def _read_total_region(
    img: Image.Image,
    box: dict,
    scale_x: float,
    scale_y: float,
    orig_w: int,
    orig_h: int,
    label: str,
) -> dict:
    """在裁框上做第二次识别，并把结果映射回原图坐标。"""
    # 原图框 -> 工作图框：向下取整 / 向上取整，宁可多切一点，不让边缘字被切掉
    x0 = max(0, min(img.width - 1, int(math.floor(box["left"] / scale_x))))
    y0 = max(0, min(img.height - 1, int(math.floor(box["top"] / scale_y))))
    x1 = max(x0 + 1, min(img.width, int(math.ceil((box["left"] + box["width"]) / scale_x))))
    y1 = max(y0 + 1, min(img.height, int(math.ceil((box["top"] + box["height"]) / scale_y))))

    patch, inner = _fit_for_infer(img.crop((x0, y0, x1, y1)))
    result = _run_engine(patch)

    lines = _collect_lines(
        result,
        inner * scale_x,
        x0 * scale_x,
        inner * scale_y,
        y0 * scale_y,
        orig_w,
        orig_h,
    )
    lines.sort(key=_sort_key)
    return {
        # 返回实际裁到的框（换算回原图），客户端可以据此核对区域
        "box": {
            "top": int(round(y0 * scale_y)),
            "left": int(round(x0 * scale_x)),
            "width": int(round((x1 - x0) * scale_x)),
            "height": int(round((y1 - y0) * scale_y)),
        },
        "lines": lines,
        "matchedLabel": label,
    }


def _recognize_sync(raw: bytes, deadline: float | None = None) -> dict:
    """同步识别（在线程池里跑，不阻塞事件循环）：首轮 + 至多一次合计区域重读。

    deadline 是 monotonic 时间点，两次推理共用；None 表示按 TOTAL_BUDGET_MS 从现在起算。
    """
    started = time.monotonic()
    if deadline is None:
        deadline = started + TOTAL_BUDGET_MS / 1000.0

    img, orig_w, orig_h = _decode(raw)
    work_w, work_h = img.size
    # 缩小识别后把框按比例还原到原图像素空间，客户端才能直接和原图做版面配对
    scale_x = orig_w / float(work_w)
    scale_y = orig_h / float(work_h)

    lines = _collect_lines(_run_engine(img), scale_x, 0.0, scale_y, 0.0, orig_w, orig_h)
    lines.sort(key=_sort_key)

    warnings: list[str] = []
    crop = None
    label, box = plan_crop(lines, orig_w, orig_h)

    if label and box:
        remaining_ms = int((deadline - time.monotonic()) * 1000)
        if remaining_ms < SECOND_PASS_MIN_MS:
            warnings.append(
                f"合计标签「{label}」附近没有金额，但剩余 {max(0, remaining_ms)}ms "
                f"不足 {SECOND_PASS_MIN_MS}ms，放弃裁图重读"
            )
        else:
            try:
                crop = _read_total_region(img, box, scale_x, scale_y, orig_w, orig_h, label)
            except OCRError as exc:
                crop = None
                warnings.append(f"合计区域二次识别失败（{exc.code}），已返回首轮结果")

        if crop is not None:
            if not crop["lines"]:
                warnings.append(f"合计区域二次识别未检出文字（{label}）")
            lines = merge_lines(lines, crop["lines"])

    return {
        "lines": lines,
        "avgScore": _avg_score(lines),
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "passes": 2 if crop is not None else 1,
        "warnings": warnings,
        "crop": crop,
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

    # 总时限从收包开始算：排队 + 解码 + 两次推理共用一个 deadline
    deadline = started + TOTAL_BUDGET_MS / 1000.0
    # 信号量覆盖「解码 + 识别」整段，真正压住 CPU 与内存峰值
    async with _semaphore:
        payload = await asyncio.to_thread(_recognize_sync, raw, deadline)

    payload["elapsedMs"] = int((time.monotonic() - started) * 1000)
    # 只记字节数与耗时，绝不打印图片内容或识别文本
    logger.info(
        "ocr ok bytes=%d lines=%d avgScore=%.3f passes=%d elapsedMs=%d warnings=%d",
        len(raw),
        len(payload["lines"]),
        payload["avgScore"],
        payload["passes"],
        payload["elapsedMs"],
        len(payload["warnings"]),
    )
    return payload


# ── 深度识别（第三层兜底，默认关闭，仅测试用）────────────
# 约束：默认关闭（OCR_DEEP_ENABLED!=1 一律 503）、单并发、严格超时、
#      只回结构化字段，不落盘、不打印图片或回答内容。
DEEP_ENABLED = os.environ.get("OCR_DEEP_ENABLED", "0").strip() == "1"
DEEP_URL = os.environ.get("OLLAMA_URL", "http://host.docker.internal:11434").rstrip("/")
DEEP_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl:7b")
DEEP_TIMEOUT_MS = _env_int("OCR_DEEP_TIMEOUT_MS", 120000)
_DEEP_SEM = asyncio.Semaphore(1)

DEEP_PROMPT = (
    "这是一张收据或账单的照片。请只输出两行，不要任何解释："
    "第一行：票面最终的应付金额（纯数字，不要货币符号；看不清就写 unknown）；"
    "第二行：货币代码（RM 写 MYR，S$ 写 SGD，其他按票面）。"
)


def _parse_deep_answer(text):
    """从模型回答里抠出金额与币种；抠不出返回 (None, None)，绝不瞎猜。"""
    if not text:
        return None, None
    amount = None
    currency = None
    for raw_line in text.splitlines():
        line = raw_line.strip().strip("`*_ ")
        if not line:
            continue
        if amount is None:
            m = re.search(r"(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)", line)
            if m and not re.fullmatch(r"20\d{2}", m.group(1)):
                try:
                    amount = float(m.group(1).replace(",", ""))
                except ValueError:
                    amount = None
                if amount is not None:
                    continue
        if currency is None:
            m2 = re.search(r"(MYR|RM|SGD|CNY|RMB|USD|HKD|TWD|THB|IDR|PHP|VND|JPY)", line, re.I)
            if m2:
                tok = m2.group(1).upper()
                currency = {"RM": "MYR", "RMB": "CNY"}.get(tok, tok)
    return amount, currency


@router.post("/deep")
async def ocr_deep(file: UploadFile = File(...), _: None = Depends(require_key)) -> dict:
    if not DEEP_ENABLED:
        raise OCRError("DEEP_DISABLED", "深度识别未启用（OCR_DEEP_ENABLED=0）")

    started = time.monotonic()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in LAX_MIME:
        raise OCRError("BAD_IMAGE", "不支持的 Content-Type: " + (content_type or "empty"))
    raw = await _read_limited(file)
    b64 = base64.b64encode(raw).decode("ascii")

    body = {
        "model": DEEP_MODEL,
        "prompt": DEEP_PROMPT,
        "images": [b64],
        "stream": False,
        "options": {"temperature": 0, "num_predict": 48},
    }

    async with _DEEP_SEM:
        try:
            async with httpx.AsyncClient(timeout=DEEP_TIMEOUT_MS / 1000.0) as client:
                resp = await client.post(DEEP_URL + "/api/generate", json=body)
        except httpx.TimeoutException:
            raise OCRError("DEEP_TIMEOUT", "深度识别超时（%dms）" % DEEP_TIMEOUT_MS)
        except Exception as exc:
            raise OCRError("DEEP_UNAVAILABLE", "连不上推理服务：" + type(exc).__name__)

    if resp.status_code != 200:
        raise OCRError("DEEP_ERROR", "推理服务返回 %d" % resp.status_code)

    data = resp.json()
    answer = str(data.get("response") or "")
    amount, currency = _parse_deep_answer(answer)
    elapsed = int((time.monotonic() - started) * 1000)
    logger.info("ocr deep bytes=%d model=%s elapsedMs=%d amount=%s", len(raw), DEEP_MODEL, elapsed, amount)
    return {
        "model": DEEP_MODEL,
        "answer": answer.strip()[:400],
        "amount": amount,
        "currency": currency,
        "elapsedMs": elapsed,
        "loadMs": int((data.get("load_duration") or 0) / 1e6),
    }

# ── 应用装配 ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def _lifespan(_: FastAPI):
    if not OCR_SHARED_KEY:
        logger.error("OCR_SHARED_KEY 未设置：/ocr/lines 将全部拒绝，仅健康检查可用")
    logger.info("ocr total budget %dms", TOTAL_BUDGET_MS)
    yield


app = FastAPI(
    title="jishiben OCR",
    version="0.2.0",
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
