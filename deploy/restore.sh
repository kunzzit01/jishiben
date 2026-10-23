#!/usr/bin/env bash
# ============================================================
# jishiben MySQL 逻辑恢复：gunzip -> mysql，并做恢复前后行数对账
#
# 用法：
#   ./deploy/restore.sh deploy/backups/jishiben-jishiben-20250101T000000Z.sql.gz
#   ./deploy/restore.sh <dump> --yes          # 自动化（跳过确认）
#   ./deploy/restore.sh <dump> --skip-count-check
#
# 对账规则：
#   1) 有同名 .counts 快照（backup.sh 生成）时，恢复后每张关键表行数必须与快照完全一致，
#      任何一条不一致 -> 退出码 1。
#   2) 没有 .counts 时，退化为「恢复后 vs 恢复前」差值报告，并要求关键表非全空。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"
KEY_TABLES="${KEY_TABLES:-users profiles ledgers assets category_groups categories transactions budgets payment_plans push_tokens exchange_rates}"

die() { printf 'restore: %s\n' "$*" >&2; exit 1; }
log() { printf '[restore %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

usage() {
  cat <<'USAGE'
用法: restore.sh <dump.sql.gz> [--yes] [--skip-count-check]
  <dump.sql.gz>         backup.sh 生成的备份文件
  --yes                 跳过交互确认（自动化用）
  --skip-count-check    跳过恢复后的行数对账（不建议）
USAGE
}

DUMP=""
ASSUME_YES=0
COUNT_CHECK=1
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --skip-count-check) COUNT_CHECK=0 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage; die "未知参数 $arg" ;;
    *) if [[ -n "$DUMP" ]]; then usage; die "只接受一个备份文件参数"; fi; DUMP="$arg" ;;
  esac
done
if [[ -z "$DUMP" ]]; then usage; die "缺少备份文件参数"; fi
[[ -f "$DUMP" ]] || die "备份文件不存在：$DUMP"
[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE（先执行 cp .env.example deploy/.env 并填写）"
command -v docker >/dev/null 2>&1 || die "未找到 docker 命令"
command -v gunzip >/dev/null 2>&1 || die "未找到 gunzip 命令"

set -a; # shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${DB_NAME:?DB_NAME 未设置}" "${DB_USER:?DB_USER 未设置}" "${DB_PASSWORD:?DB_PASSWORD 未设置}"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
mysql_exec() { dc exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql "$@"; }

# 1) 完整性校验：有 .sha256 就先验哈希
if [[ -f "$DUMP.sha256" ]]; then
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" ) || die "sha256 校验失败，备份文件可能被截断或篡改"
  log "sha256 校验通过"
fi
gunzip -t "$DUMP" || die "gzip 完整性校验失败"

# 2) 精确行数（information_schema.tables.table_rows 是估算值，不能用于对账）
count_rows() {
  local table="$1" out
  if ! out="$(mysql_exec mysql -N -B -u"$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM $table" 2>/dev/null)"; then
    printf "NA\n"; return
  fi
  printf "%s\n" "$out" | tail -n1 | tr -d "[:space:]"
}

declare -A PRE POST EXPECTED
for t in $KEY_TABLES; do PRE["$t"]="$(count_rows "$t")"; done

log "目标库 $DB_NAME，备份文件 $(basename "$DUMP")"
if (( ! ASSUME_YES )); then
  printf "恢复会覆盖 $DB_NAME 中的同名表（先 DROP 再 CREATE）。继续？[yes/N] "
  read -r answer
  [[ "$answer" == "yes" ]] || die "已取消（未做任何改动）"
fi

log "导入中..."
gunzip -c "$DUMP" | mysql_exec mysql --default-character-set=utf8mb4 -u"$DB_USER" "$DB_NAME"
log "导入完成"

# 3) 对账
COMPANION="$DUMP.counts"
HAS_EXPECTED=0
if [[ -f "$COMPANION" ]]; then
  while read -r name value; do
    if [[ -n "${name:-}" ]]; then EXPECTED["$name"]="${value:-NA}"; fi
  done < "$COMPANION"
  HAS_EXPECTED=1
fi

FAILED=0
printf '\n行数对账（关键表）：\n'
printf '  %-18s %12s %12s %12s\n' 'table' 'before' 'after' 'expected'
for t in $KEY_TABLES; do
  after="$(count_rows "$t")"
  POST["$t"]="$after"
  exp="${EXPECTED[$t]:--}"
  printf "  %-18s %12s %12s %12s" "$t" "${PRE[$t]:-NA}" "$after" "$exp"
  if (( HAS_EXPECTED )) && [[ "$exp" != "-" && "$exp" != "NA" ]]; then
    if [[ "$after" == "$exp" ]]; then printf "  OK\n"; else printf "  MISMATCH\n"; FAILED=1; fi
  else
    printf "\n"
  fi
done

if (( ! COUNT_CHECK )); then
  log "--skip-count-check 生效：对账结果仅供参考，退出码 0"
  exit 0
fi

if (( ! HAS_EXPECTED )); then
  total=0
  for t in users ledgers transactions; do
    v="${POST[$t]:-0}"
    if [[ "$v" =~ ^[0-9]+$$ ]]; then total=$((total + v)); fi
  done
  (( total > 0 )) || die "缺少 .counts 快照，且恢复后关键表全空，无法证明恢复成功"
  log "无 .counts 快照：已退化为基础校验（关键表非空）；建议今后保留 backup.sh 生成的 .counts"
fi

(( FAILED == 0 )) || die "行数对账不一致：恢复结果与备份快照不符，请检查日志"
log "行数对账通过，恢复成功"
