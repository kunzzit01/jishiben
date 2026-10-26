# AI 功能配置（小票识别 / 语音记账）

## 一、架构（重要）

```
App（不含任何 key）
   └─ POST /api/ai/receipt-scan（带用户 JWT）
        └─ 后端 Spring Boot（持有 OPENROUTER_API_KEY）
             └─ OpenRouter（视觉模型）
```

**严禁把 key 写进前端代码**：`EXPO_PUBLIC_*` 前缀或任何常量都会内联进 APK，
任何人安装后可直接提取并盗刷你的额度。项目里对 key 的检查应保持：

```bash
grep -r "sk-or-v1" src/ App.tsx   # 必须为 0
```

## 二、服务端配置

`/opt/jishiben/deploy/.env`：

```bash
OPENROUTER_API_KEY=sk-or-v1-xxxx
# 免费视觉模型（额度用尽时用它；付费模型需账户有余额）
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
AI_VOICE_STT_MODEL=qwen/qwen3-asr-flash-2026-02-10
```

```bash
docker compose -f deploy/docker-compose.yml up -d api
docker exec jishiben-api env | grep -i openrouter   # 确认变量已传进容器
```

> 早期版本 `deploy/docker-compose.yml` **没有透传**这几个变量，导致 key 填了也永远 503，
> 已修复（commit 2acc9989）。

## 三、验证

```bash
IP=187.127.125.136
T=$(curl -s -X POST https://$IP/api/auth/login -H 'content-type: application/json' \
     -d '{"email":"mingsoon249@gmail.com","password":"12345678"}' \
   | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

curl -s -o /dev/null -w "%{http_code}\n" -X POST https://$IP/api/ai/receipt-scan \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"imageBase64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}'
```

| 返回 | 含义 | 处理 |
|---|---|---|
| 503 `AI_NOT_CONFIGURED` | 容器里没有 key | 检查 `docker exec jishiben-api env\|grep OPENROUTER` |
| 200 | 链路通 | — |
| 402 / 403 | key 额度不足 | 换免费模型或充值 |
| 502 / 504 | 上游失败/超时 | 换模型，或调大 `app.ai.receipt-scan.timeout-ms` |

## 四、key 额度自查

```bash
curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer sk-or-v1-xxx" \
  | python3 -m json.tool | head -20
```

关注 `limit_remaining`：**≤0 时付费模型必然失败**（本项目遇到过 `limit 0.3` 已花 `0.315` 的情况）。

免费视觉模型（2026-10 实测可用，均以 `:free` 结尾）：

```
nvidia/nemotron-3.5-super-vl:free
dots-studio/dots-3-note-preview:free
thinkingmachines/inkling:free
thinkingmachines/inkling-small:free
```

> 免费模型有速率限制、稳定性弱于付费档，仅建议用于验证流程或低频使用。

## 五、未配置时的行为

接口返回 `503 AI_NOT_CONFIGURED`，App 会弹出「服务端还没有配置小票识别服务」并降级为
手动记账 —— **这是设计好的降级，不是故障**。
