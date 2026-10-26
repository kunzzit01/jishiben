#!/usr/bin/env bash
# Let's Encrypt IP 证书自动续期（160 小时有效期）
#
# 关键设计：先判断是否真需要续期，再决定要不要停 Traefik。
# 早期版本每次运行都停 Traefik（约 14 秒），而 timer 每 6 小时跑一次，
# 等于每天无故让业务站点中断约 4 次 —— 不可接受。
#
# 逻辑：
#   1. 读当前证书剩余有效期；> 60 小时直接退出（完全不碰 Traefik）
#   2. 剩余 <= 60 小时（证书 160h，certbot 在剩 1/3≈53h 时续期）→ 停 → renew → 起
#   3. 复制新证书到 Traefik 可读的 volume，并 touch 动态配置触发重载
set -euo pipefail

IP="187.127.125.136"
TRAEFIK="traefik-traefik-1"
VOL="/var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/jishiben"
DYN="/docker/traefik/dynamic/jishiben-tls.yml"
LOG="/var/log/jishiben-cert-renew.log"
THRESHOLD_H=60

exec >>"$LOG" 2>&1
echo "[$(date -Is)] ==== renew start ===="

# ---- 1. 先看要不要续 ----
if [ -f "$VOL/fullchain.pem" ]; then
  END=$(openssl x509 -enddate -noout -in "$VOL/fullchain.pem" | cut -d= -f2)
  END_S=$(date -d "$END" +%s 2>/dev/null || echo 0)
  NOW_S=$(date +%s)
  REMAIN=$(( END_S - NOW_S ))
  echo "[$(date -Is)] current cert expires: $END (remaining ${REMAIN}s)"
  if [ "$REMAIN" -gt $(( THRESHOLD_H * 3600 )) ]; then
    echo "[$(date -Is)] SKIP: remaining > ${THRESHOLD_H}h, Traefik untouched"
    echo "[$(date -Is)] ==== renew skip ===="
    exit 0
  fi
else
  echo "[$(date -Is)] no cert in $VOL, will renew"
fi

# ---- 2. 真要续：短暂停 Traefik（trap 保证一定拉起）----
echo "[$(date -Is)] stopping traefik for HTTP-01"
docker stop "$TRAEFIK" >/dev/null
trap 'docker start "$TRAEFIK" >/dev/null; echo "[$(date -Is)] traefik restarted"' EXIT

sleep 2
/snap/bin/certbot renew --quiet

# ---- 3. 部署新证书 ----
mkdir -p "$VOL"
cp -f "/etc/letsencrypt/live/$IP/fullchain.pem" "$VOL/fullchain.pem"
cp -f "/etc/letsencrypt/live/$IP/privkey.pem"   "$VOL/privkey.pem"
chmod 644 "$VOL/fullchain.pem"
chmod 600 "$VOL/privkey.pem"
touch "$DYN"

echo "[$(date -Is)] new expires: $(openssl x509 -enddate -noout -in "$VOL/fullchain.pem" 2>/dev/null)"
echo "[$(date -Is)] ==== renew done ===="
