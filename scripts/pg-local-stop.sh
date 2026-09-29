#!/usr/bin/env bash
# 停止 pg-local-start.sh 启动的用户态 PostgreSQL
set -euo pipefail
BASE="${PG_LOCAL_DIR:-/tmp/pglocal}"
DATA="${PG_DATA_DIR:-/tmp/pgdata}"
export PATH="$BASE/usr/lib/postgresql/15/bin:$PATH"
export LD_LIBRARY_PATH="$BASE/usr/lib/postgresql/15/lib:${LD_LIBRARY_PATH:-}"
pg_ctl -D "$DATA" stop -m fast || true
