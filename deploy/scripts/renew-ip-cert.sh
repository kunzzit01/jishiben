#!/usr/bin/env bash
# Let's Encrypt IP 证书自动续期（160 小时有效期 → 约每 5 天必须成功一次）
#
# 流程：停 Traefik → certbot renew（standalone 需要 :80）→ 起 Traefik
#       → 复制新证书到 Traefik 的 /letsencrypt volume → touch 动态配置触发重载
set -euo pipefail

IP="187.127.125.136"
TRAEFIK="traefik-traefik-1"
VOL="/var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/jishiben"
DYN="/docker/traefik/dynamic/jishiben-tls.yml"
LOG="/var/log/jishiben-cert-renew.log"

exec >>"$LOG" 2>&1
echo "[$(date -Is)] ==== renew start ===="

docker stop "$TRAEFIK" >/dev/null
trap 'docker start "$TRAEFIK" >/dev/null; echo "[$(date -Is)] traefik restarted"' EXIT

sleep 2
/snap/bin/certbot renew --quiet

mkdir -p "$VOL"
cp -f "/etc/letsencrypt/live/$IP/fullchain.pem" "$VOL/fullchain.pem"
cp -f "/etc/letsencrypt/live/$IP/privkey.pem"   "$VOL/privkey.pem"
chmod 644 "$VOL/fullchain.pem"
chmod 600 "$VOL/privkey.pem"

touch "$DYN"   # file provider 重载 → 读到新证书，无需重启 Traefik

echo "[$(date -Is)] expires: $(openssl x509 -enddate -noout -in "$VOL/fullchain.pem" 2>/dev/null || echo unknown)"
echo "[$(date -Is)] ==== renew done ===="
