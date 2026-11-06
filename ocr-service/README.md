# ocr-service —— 服务端 OCR 兜底（RapidOCR）

客户端本地 OCR 走 Google ML Kit（离线、快），但对手写发票、热敏纸、反光/斜拍照片识别很差。
这里提供一个**只做识别、不做业务判断**的微服务：输入图片，输出文字 + 像素坐标，
金额/日期解析仍然全部留在客户端，避免服务端与客户端两套逻辑漂移。

引擎：**RapidOCR**（PaddleOCR PP-OCR 的 ONNX 版，pip 包名 `rapidocr_onnxruntime`，
TeleBot 用的同款），默认模型为 `ch_PP-OCRv4` 检测 + 识别 + 方向分类。

## 目录

| 文件 | 作用 |
| --- | --- |
| `app.py` | FastAPI 应用：`GET /ocr/health`、`POST /ocr/lines` |
| `requirements.txt` | 固定版本依赖 |
| `Dockerfile` | python:3.11-slim 运行时，非 root 用户 10001 |
| `README.md` | 本文件 |

## 接口

### GET /ocr/health —— 无需密钥

不触发模型加载，容器探活可以高频打。

```bash
curl -s http://127.0.0.1:8090/ocr/health
```

```json
{"status":"ok","engine":"rapidocr","version":"1.4.4","engineLoaded":false}
```

`engineLoaded` 用来区分「服务起来了」和「模型已经加载过」——首次识别会慢一点，看这个值就知道。

### POST /ocr/lines —— 需要 `X-OCR-Key` 头

`multipart/form-data`，字段名 `file`，支持 jpeg / png / webp，**上传上限 8MB**。

```bash
curl -s -X POST http://127.0.0.1:8090/ocr/lines \
  -H "X-OCR-Key: $OCR_SHARED_KEY" \
  -F "file=@/tmp/receipt.jpg;type=image/jpeg"
```

真实响应（实测，一张 800x300 的测试图）：

```json
{
  "lines": [
    {"text": "RECEIPT 88.00", "top": 58,  "left": 34, "width": 421, "height": 48, "score": 0.9543},
    {"text": "JISHIBEN OCR",  "top": 178, "left": 36, "width": 414, "height": 47, "score": 0.9928}
  ],
  "avgScore": 0.9735,
  "elapsedMs": 922
}
```

字段含义：

- `text`：该行文字（已 strip，空串不返回）
- `top` / `left` / `width` / `height`：**像素整数**，坐标系是**原图**（不是内部缩放后的图）。
  内部会把最长边压到 2000px 再识别，识别完把框按比例还原到原图坐标，
  客户端可以直接拿它和本地原图做版面配对。
- `score`：该行识别置信度（0–1，保留 4 位）
- `avgScore`：所有行置信度均值；**识别不到文字时为 `0.0`、`lines` 为空数组**，不是错误
- `elapsedMs`：本次请求服务端总耗时（含解码、缩放、识别）

排序：按 `(top, left)` 升序，即从上到下、同一行从左到右。

### 错误

所有错误都是同一套 JSON 信封：`{"code": "...", "message": "..."}`。

| HTTP | code | 触发条件 |
| --- | --- | --- |
| 400 | `BAD_IMAGE` | 解码失败 / 内容不是图片 / 缺 `file` 字段 / 空文件 / 不支持的 Content-Type |
| 413 | `TOO_LARGE` | 上传字节数超过 8MB（经 nginx 时 >10MB 会先被 nginx 挡掉，返回 nginx 自己的 HTML 413） |
| 401 | `UNAUTHORIZED` | `X-OCR-Key` 缺失或不匹配 |
| 500 | `ENGINE_ERROR` | 引擎推理异常，或服务端没配 `OCR_SHARED_KEY` |
| 404 | `NOT_FOUND` | 路径写错 |

```json
{"code":"UNAUTHORIZED","message":"X-OCR-Key 缺失或无效"}
{"code":"BAD_IMAGE","message":"无法解码图片，仅支持 jpeg/png/webp"}
{"code":"TOO_LARGE","message":"图片超过 8MB 上限"}
```

## 本地构建与运行

在仓库根目录：

```bash
docker build -t jishiben/ocr:0.1.0 ./ocr-service

# 直接跑单容器（密钥自己先定一个）
docker run --rm -p 8090:8090 -e OCR_SHARED_KEY=dev-only-key jishiben/ocr:0.1.0

# 不经 docker，本机跑（需要 Python 3.11）
cd ocr-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
OCR_SHARED_KEY=dev-only-key uvicorn app:app --host 127.0.0.1 --port 8090 --workers 1
```

容器内以 uid 10001 的非 root 用户运行，`HOME=/home/ocr` 可写。

## 生成密钥并配置

```bash
openssl rand -hex 32          # 生成 64 位十六进制密钥
```

把结果写进部署机上的 `deploy/.env`（该文件不提交）：

```dotenv
OCR_SHARED_KEY=<上面生成的值>
```

`deploy/docker-compose.yml` 里写的是 `OCR_SHARED_KEY: ${OCR_SHARED_KEY:?OCR_SHARED_KEY is required}`，
没配就起不来（而不是悄悄退化成开放接口）。服务端侧同理：`OCR_SHARED_KEY` 为空时
所有 `/ocr/lines` 请求一律拒绝，只有健康检查可用。

> 客户端要把这个值编进安装包（或由登录后的下发接口获取）。它只是防止接口被公网随意刷，
> **不是**用户级鉴权——真要按用户限流，后续在 nginx 或 API 层按 IP/用户加限速。

## 测一张图（三步）

```bash
# 1. 服务自己在容器里是否通（部署机上，不进 nginx）
docker exec jishiben-ocr python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8090/ocr/health',timeout=3).read().decode())"

# 2. 经 nginx 走客户端真实路径
curl -s http://<你的地址>/ocr/health

# 3. 真实识别一张图
curl -s -X POST http://<你的地址>/ocr/lines \
  -H "X-OCR-Key: $OCR_SHARED_KEY" \
  -F "file=@/path/to/receipt.jpg;type=image/jpeg" | head -c 800
```

返回 401 说明头没带上或值不同；返回 `BAD_IMAGE` 说明要么不是图片，要么图片其实没传上去。

## 模型从哪来（首次调用会不会下载？）

**当前固定版本 `rapidocr_onnxruntime==1.4.4` 把模型打进了 wheel**，装完就在
`site-packages/rapidocr_onnxruntime/models/` 里，实测文件：

```
ch_PP-OCRv4_det_infer.onnx          4636 KB   文本框检测
ch_PP-OCRv4_rec_infer.onnx         10604 KB   文字识别
ch_ppocr_mobile_v2.0_cls_infer.onnx  572 KB   方向分类
```

也就是说：**运行时不联网、不下载、不写缓存**。所谓「首次调用慢」，只是
onnxruntime 建立推理会话的初始化（实测约 0.3s，VPS 冷盘/低配可能到 1–3s），
之后进程内单例复用，不再重复初始化。

如果以后升级到会自己下权重的版本（例如包名从 `rapidocr_onnxruntime` 换成 `rapidocr` 的 2.x），
行为会变成首次调用下载到 `~/.cache`。本镜像已经为此留了可写的 `HOME=/home/ocr`，
但线上不建议依赖运行时下载（断网或镜像重建后每次冷启动都要重下）。两种处理方式：

1. **构建期预热**（镜像 +约 15MB，构建时间 +几秒，运行时零下载）：

   ```dockerfile
   # 放在 pip install 之后、COPY app.py 之前
   RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"
   ```

2. **挂持久卷**到 `/home/ocr/.cache`，容器重建后不用重下。

当前 1.4.4 两者都不需要，按现状即可。

## 资源与并发

- 并发上限：进程内 `asyncio.Semaphore(2)`，覆盖「解码 + 识别」整段，最多 2 张同时在算。
- 单 worker：模型是进程内单例，`--workers 1` 固定写死；多 worker 会各复制一份模型
  （内存翻倍 + 首次加载重复）。要提速请横向加副本，不要加 worker。
- 内存上限：compose 里 `mem_limit: 2g`（Swarm 部署改用 `deploy.resources.limits.memory`）。
- 图片尺寸：解码后最长边压到 2000px 再识别，控内存也稳住耗时；坐标已还原到原图，客户端无感知。
  JPEG 用 `Image.draft()` 在解码阶段就降采样，避免超大图整张进内存。
- 上传上限：8MB（应用层按块读并累计，不信 `Content-Length`）；nginx `/ocr/` 处设为 10m。
- 镜像约 1.0GB：onnxruntime + opencv-python 占大头（`site-packages` 417MB），另加 libGL 那批
  X/GL 运行库 248MB。想瘦身只能换 `opencv-python-headless`（省掉 libGL），但那等于额外固定一个依赖，
  不在本次范围内。

## 日志

只打字节数和耗时，**从不打印图片内容或识别文本**：

```
2026-11-06 07:16:54,868 INFO jishiben.ocr ocr ok bytes=8508 lines=3 avgScore=0.993 elapsedMs=1666
```

## 和部署的关系

- compose 服务名 `ocr`，容器名 `jishiben-ocr`，**不发布宿主端口**（只有 `expose: 8090`），
  只能在 `jishiben-net` 内网访问。
- web 容器的 nginx 把 `/ocr/` 原样反代到 `http://ocr:8090`（保留 `/ocr/` 前缀，
  `X-OCR-Key` 等请求头默认透传），`client_max_body_size 10m`、`proxy_read_timeout 60s`。
- 上游用变量 + Docker 内置 DNS 在请求时解析，所以 ocr 容器比 nginx 晚起来也不会让 nginx 起不来；
  代价是 ocr 没起来时返回的是 **502**（不是 404）。
- 容器内另有同一套路由的裸路径（`/health`、`/lines`），只用于直连 8090 调试。

## 客户端契约对照（已核对 src/utils/receiptOcrRemote.ts）

客户端（同仓库 `src/utils/receiptOcrRemote.ts`）就是按这套契约写的，两边已对齐：

- `POST /ocr/lines`，请求头 `X-OCR-Key`，multipart 字段名 `file`
- `GET /ocr/health` 探测服务状态（会把密钥头一起带上；服务端对 health 不校验密钥）
- HTTP 状态码映射：`401/403` → 密钥错（会熔断 10 分钟）、`400` → 图片问题（只放弃这一张）、
  `413` → 太大、其余 → 引擎错误
- 客户端**单次上传超时只有 6 秒**（宁可放弃兜底也不让用户等）

因此有一个部署后的必做动作：**先预热一次**，让模型在容器里加载好，否则第一个用户请求
可能因为「冷启动 + 识别」超过 6 秒而被客户端判超时（服务端其实算完了，只是客户端不等了）。

```bash
# 部署完，用任意一张小图打一次（走客户端同一条路径），把模型加载进进程
curl -s -X POST http://<你的地址>/ocr/lines \
  -H "X-OCR-Key: $OCR_SHARED_KEY" \
  -F "file=@/path/to/receipt.jpg;type=image/jpeg" >/dev/null

# 确认已经预热：engineLoaded 应为 true
curl -s http://<你的地址>/ocr/health
```

已知限制：**HEIC 不支持**（Pillow 默认不解 HEIC，且项目里没有 pillow-heif）。
客户端传 HEIC 会拿到 400 `BAD_IMAGE`，按上面的映射只影响这一张图，不熔断。

## 不做的事

- 不解析金额、日期、商家名，不判断票据类型——这些留在客户端，避免两套逻辑漂移。
- 不存图片：请求处理完即释放，不落盘、不入库。
- 不提供用户级鉴权/计费，只有共享密钥这一道闸。
