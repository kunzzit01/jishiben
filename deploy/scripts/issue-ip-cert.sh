#!/usr/bin/env bash
# 一次性签发 Let's Encrypt IP 证书（HTTP-01 standalone）
#
# 为什么必须停 Traefik：实测 Traefik 3.7.6 内置 ACME 挑战处理器无法被用户路由覆盖
# （priority 2147483647 仍返回 404），而 HTTP-01 必须由 :80 提供服务。
#
# 用法：
#   ./issue-ip-cert.sh                 # staging（默认，先验证流程）
#   ./issue-ip-cert.sh --production    # 正式证书
#   ./issue-ip-cert.sh --production --reset   # 先删掉 staging 的 lineage 再签正式（推荐）
#
# 安全措施：trap 保证无论成功失败，退出时一定把 Traefik 拉起来。
set -euo pipefail

IP="187.127.125.136"
EMAIL="admin@srv1808383.hstgr.cloud"
TRAEFIK="traefik-traefik-1"

PROD=0
RESET=0
for a in "$@"; do
  case "$a" in
    --production) PROD=1 ;;
    --reset)      RESET=1 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

# certbot 没有 --production 参数：不传 --staging 就是正式 CA
STAGING_FLAG="--staging"
[ "$PROD" = "1" ] && STAGING_FLAG=""

if [ "$RESET" = "1" ]; then
  echo "==> 删除旧 lineage（staging → production 必须清掉旧证书，否则会复用 staging 链）"
  rm -rf "/etc/letsencrypt/live/$IP" "/etc/letsencrypt/archive/$IP" "/etc/letsencrypt/renewal/$IP.conf"
fi

echo "==> 停止 Traefik（让出 :80，预计 20-40 秒）"
docker stop "$TRAEFIK" >/dev/null
trap 'echo "==> 恢复 Traefik"; docker start "$TRAEFIK" >/dev/null; echo "    ok"; curl -sk -o /dev/null -w "    kunzzgroup.com → %{http_code}\n" https://kunzzgroup.com/ || true' EXIT

sleep 2
echo "==> 申请证书（staging=${PROD:+0}${PROD:-1} / $([ $PROD = 1 ] && echo production || echo staging)）"
/snap/bin/certbot certonly --standalone \
  --ip-address "$IP" \
  --preferred-profile shortlived \
  $STAGING_FLAG \
  --non-interactive --agree-tos -m "$EMAIL"

echo "==> 结果"
ls -la /etc/letsencrypt/live/ 2>/dev/null || true
