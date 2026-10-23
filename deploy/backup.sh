#!/usr/bin/env bash
# ============================================================
# jishiben MySQL 逻辑备份：mysqldump -> gzip(9) + sha256 + 行数快照
# 用法：
#   ./deploy/backup.sh                 # 备份到 deploy/backups/
#   KEEP=7 ./deploy/backup.sh          # 只保留最近 7 份
#   BACKUP_DIR=/data/bk ./deploy/backup.sh
# 产物三件套：<name>.sql.gz / <name>.sql.gz.sha256 / <name>.sql.gz.counts
# restore.sh 会读 .counts 做行数对账，请不要手工删掉它。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
KEEP="${KEEP:-${BACKUP_KEEP:-14}}"
KEY_TABLES="${KEY_TABLES:-users profiles ledgers assets category_groups categories transactions budgets payment_plans push_tokens exchange_rates}"

die() { printf 'backup: %s\n' "$*" >&2; exit 1; }
log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE（先执行 cp .env.example deploy/.env 并填写）"
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"

set -a; # shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DB_NAME:?DB_NAME 未设置}" "${DB_USER:?DB_USER 未设置}" "${DB_PASSWORD:?DB_PASSWORD 未设置}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/jishiben-${DB_NAME}-${STAMP}.sql.gz"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
# MYSQL_PWD 走环境变量，口令不出现在宿主机 ps 参数里
mysql_exec() { dc exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql "$@"; }

# 精确行数：information_schema.tables.table_rows 是估算值，不能用于对账
count_rows() {
  local table="$1" out
  if ! out="$(mysql_exec mysql -N -B -u"$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM $table" 2>/dev/null)"; then
    printf "NA\n"; return
  fi
  printf "%s\n" "$out" | tail -n1 | tr -d "[:space:]"
}

log "开始导出 $DB_NAME -> $DUMP"
mysql_exec mysqldump \
  -u"$DB_USER" \
  --no-tablespaces \
  --single-transaction \
  --quick \
  --skip-lock-tables \
  --default-character-set=utf8mb4 \
  --set-gtid-purged=OFF \
  --triggers \
  --routines \
  "$DB_NAME" | gzip -9 > "$DUMP"

[[ -s "$DUMP" ]] || die "导出文件为空，备份失败"
gzip -t "$DUMP" || die "gzip 完整性校验失败"

BYTES="$(wc -c < "$DUMP" | tr -d "[:space:]")"
[[ "$BYTES" -gt 1024 ]] || die "导出文件过小（$BYTES 字节），疑似 mysqldump 未真正执行"

# sha256 只记文件名，便于把目录整体搬走后仍可校验
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256" )

COUNTS="$DUMP.counts"
: > "$COUNTS"
for t in $KEY_TABLES; do
  printf "%s\t%s\n" "$t" "$(count_rows "$t")" >> "$COUNTS"
done

log "完成：$DUMP ($BYTES 字节)"
log "sha256 与行数快照：$(basename "$DUMP").sha256 / .counts"
printf '\n关键表行数快照：\n'
sed "s/^/  /" "$COUNTS"

if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  ls -1t "$BACKUP_DIR"/jishiben-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256" "$old.counts"
    log "清理旧备份 $(basename "$old")"
  done || true
fi
