#!/usr/bin/env bash
# 一次性签发 Let's Encrypt IP 证书（HTTP-01 standalone）
#
# 为什么必须停 Traefik：实测 Traefik 3.7.6 内置 ACME 挑战处理器无法被用户路由覆盖
# （priority 拉到 2147483647 仍返回 404），而 HTTP-01 必须由 :80 提供服务。
# 因此只能在验证的几秒内让 Traefik 让出 80 端口。
#
# 安全措施：
#   1. set -e + trap：无论 certbot 成功失败，退出时一定把 Traefik 拉起来
#   2. 默认 --staging，验证流程后再传 --production
set -euo pipefail

IP="187.127.125.136"
EMAIL="admin@srv1808383.hstgr.cloud"
TRAEFIK="traefik-traefik-1"
MODE="${1:---staging}"

echo "==> 停止 Traefik（让出 :80，预计 20-40 秒）"
docker stop "$TRAEFIK" >/dev/null
trap 'echo "==> 恢复 Traefik"; docker start "$TRAEFIK" >/dev/null; echo "    ok"' EXIT

sleep 2
echo "==> 申请证书（$MODE）"
/snap/bin/certbot certonly --standalone \
  --ip-address "$IP" \
  --preferred-profile shortlived \
  "$MODE" \
  --non-interactive --agree-tos -m "$EMAIL"

echo "==> 结果"
ls -la /etc/letsencrypt/live/ 2>/dev/null || true
