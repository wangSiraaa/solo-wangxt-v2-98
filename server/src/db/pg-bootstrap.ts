import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

// embedded-postgres 仅提供 ESM 入口，CJS 下用 createRequire 加载其默认导出
const localRequire = createRequire(__filename);
type EmbeddedPostgresInstance = import('embedded-postgres').default;
const EmbeddedPostgres = localRequire('embedded-postgres').default as new (
  opts?: Record<string, unknown>,
) => EmbeddedPostgresInstance;

export interface PgRuntimeConfig {
  port: number;
  user: string;
  password: string;
  database: string;
  dataDir: string;
}

export const DEFAULT_PG_CONFIG: PgRuntimeConfig = {
  port: Number(process.env.PG_PORT ?? 55432),
  user: 'cash',
  password: 'cash',
  database: 'cashcenter',
  dataDir: process.env.PG_DATA_DIR ?? path.join(process.cwd(), '.pgdata'),
};

let instance: EmbeddedPostgresInstance | null = null;

/**
 * 启动进程内真实 PostgreSQL（embedded-postgres 封装的官方 postgres 二进制，非 mock）。
 * 幂等：重复调用复用同一实例。PG_EXTERNAL=1 时跳过（连接外部库）。
 */
export async function ensurePostgres(
  cfg: PgRuntimeConfig = DEFAULT_PG_CONFIG,
): Promise<PgRuntimeConfig> {
  if (process.env.PG_EXTERNAL === '1') return cfg;
  if (instance) return cfg;

  const pg = new EmbeddedPostgres({
    databaseDir: cfg.dataDir,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    persistent: true,
  });
  instance = pg;

  if (!fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'))) {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    await pg.initialise();
  }
  await pg.start();

  const admin = new Client({
    host: '127.0.0.1',
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      cfg.database,
    ]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${cfg.database}`);
  } finally {
    await admin.end();
  }

  const shutdown = async () => {
    if (instance) {
      await instance.stop();
      instance = null;
    }
  };
  process.once('exit', () => {
    void pg.stop();
  });
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  return cfg;
}

export async function stopPostgres(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = null;
  }
}
