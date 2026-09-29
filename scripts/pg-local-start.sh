#!/usr/bin/env bash
# 在没有 root / docker 的环境里，用 Debian 官方 PostgreSQL 二进制包
# 在用户目录启动一个真实的 PostgreSQL 15（端口 5433，unix socket 在 /tmp/pgrun）。
set -euo pipefail

PGVER=15
BASE="${PG_LOCAL_DIR:-/tmp/pglocal}"
DATA="${PG_DATA_DIR:-/tmp/pgdata}"
PORT="${PGPORT:-5433}"

if [ ! -x "$BASE/usr/lib/postgresql/$PGVER/bin/postgres" ]; then
  echo "[pg-local] 下载并解压 PostgreSQL $PGVER（无需 root）..."
  work=$(mktemp -d)
  (
    cd "$work"
    mkdir -p lists/partial archives/partial
    apt-get -o Dir::State::Lists="$work/lists" -o Dir::Cache="$work/archives" update >/dev/null 2>&1 || true
    apt-get -o Dir::State::Lists="$work/lists" download \
      postgresql-$PGVER postgresql-client-$PGVER >/dev/null
    mkdir -p "$BASE"
    for deb in *.deb; do dpkg-deb -x "$deb" "$BASE"; done
  )
  rm -rf "$work"
fi

export PATH="$BASE/usr/lib/postgresql/$PGVER/bin:$PATH"
export LD_LIBRARY_PATH="$BASE/usr/lib/postgresql/$PGVER/lib:${LD_LIBRARY_PATH:-}"

mkdir -p /tmp/pgrun /tmp/pglog
if [ ! -d "$DATA/PG_VERSION" ]; then
  echo "[pg-local] initdb -> $DATA"
  initdb -D "$DATA" -U cashapp --auth=trust --encoding=UTF8 >/dev/null
fi

echo "[pg-local] 启动 postgres，端口 $PORT"
pg_ctl -D "$DATA" -l /tmp/pglog/pg.log -w start \
  -o "-p $PORT -k /tmp/pgrun -c listen_addresses='127.0.0.1'"

# 创建业务数据库（已存在则忽略）
createdb -h /tmp/pgrun -p "$PORT" -U cashapp cashcenter 2>/dev/null || true
psql -h /tmp/pgrun -p "$PORT" -U cashapp -d cashcenter -c 'select version();' | head -2
echo "[pg-local] 就绪：PGHOST=/tmp/pgrun PGPORT=$PORT PGUSER=cashapp PGDATABASE=cashcenter"
