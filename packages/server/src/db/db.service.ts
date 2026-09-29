import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BatchEntity,
  CassetteEntity,
  ReservationEntity,
} from './entities';

/** 默认钞箱种子数据（张）。1 元刻意只放 3 张，便于演示“小面额不足”。 */
export const DEFAULT_CASSETTES: Array<{
  denomination: number;
  stockTotal: number;
}> = [
  { denomination: 100, stockTotal: 40 },
  { denomination: 50, stockTotal: 20 },
  { denomination: 20, stockTotal: 50 },
  { denomination: 10, stockTotal: 60 },
  { denomination: 5, stockTotal: 50 },
  { denomination: 1, stockTotal: 3 },
];

export const ALL_DENOMINATIONS = DEFAULT_CASSETTES.map((c) => c.denomination);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cassettes (
  id               SERIAL PRIMARY KEY,
  denomination     INTEGER NOT NULL UNIQUE,
  stock_total      INTEGER NOT NULL CHECK (stock_total >= 0),
  stock_reserved   INTEGER NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
  stock_delivered  INTEGER NOT NULL DEFAULT 0 CHECK (stock_delivered >= 0),
  stock_rejected   INTEGER NOT NULL DEFAULT 0 CHECK (stock_rejected >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cassettes_nonnegative_available
    CHECK (stock_total - stock_reserved - stock_delivered - stock_rejected >= 0)
);

CREATE TABLE IF NOT EXISTS batches (
  id              BIGSERIAL PRIMARY KEY,
  status          VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
  total           INTEGER NOT NULL,
  feasible_count  INTEGER NOT NULL DEFAULT 0,
  reserved_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id                     BIGSERIAL PRIMARY KEY,
  batch_id               BIGINT NOT NULL REFERENCES batches(id),
  seq                    INTEGER NOT NULL,
  requested_amount       INTEGER NOT NULL CHECK (requested_amount > 0),
  allowed_denominations  INTEGER[] NOT NULL,
  max_notes              INTEGER NOT NULL CHECK (max_notes > 0),
  plan_counts            JSONB NOT NULL,
  plan_notes             INTEGER NOT NULL,
  delivered_counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejected_counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  unfinished_counts      JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivered_amount       INTEGER NOT NULL DEFAULT 0,
  rejected_amount        INTEGER NOT NULL DEFAULT 0,
  unfinished_amount      INTEGER NOT NULL DEFAULT 0,
  delivered_notes        INTEGER NOT NULL DEFAULT 0,
  reject_rate            DOUBLE PRECISION NOT NULL DEFAULT 0,
  status                 VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservations_batch ON reservations(batch_id);
`;

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);
  readonly dataSource: DataSource;

  constructor() {
    this.dataSource = new DataSource({
      type: 'postgres',
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      username: process.env.PGUSER || 'cashapp',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'cashcenter',
      entities: [CassetteEntity, ReservationEntity, BatchEntity],
      synchronize: false,
      logging: false,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.dataSource.initialize();
    this.logger.log('PostgreSQL 连接已建立');
    await this.dataSource.query(SCHEMA_SQL);
    await this.seedIfEmpty();
  }

  private async seedIfEmpty(): Promise<void> {
    const count = await this.dataSource.query(
      'SELECT count(*)::int AS n FROM cassettes',
    );
    if (Number(count[0].n) === 0) {
      for (const c of DEFAULT_CASSETTES) {
        await this.dataSource.query(
          `INSERT INTO cassettes (denomination, stock_total)
           VALUES ($1, $2)`,
          [c.denomination, c.stockTotal],
        );
      }
      this.logger.log('钞箱种子数据已写入');
    }
  }

  /** 测试/运维：清空业务数据并重置钞箱（用于可重复的核对演示） */
  async reset(cassettes?: Array<{ denomination: number; stockTotal: number }>): Promise<void> {
    await this.dataSource.query('TRUNCATE reservations RESTART IDENTITY');
    await this.dataSource.query('TRUNCATE batches RESTART IDENTITY CASCADE');
    const seed = cassettes && cassettes.length > 0 ? cassettes : DEFAULT_CASSETTES;
    for (const c of seed) {
      await this.dataSource.query(
        `INSERT INTO cassettes (denomination, stock_total, stock_reserved, stock_delivered, stock_rejected)
         VALUES ($1, $2, 0, 0, 0)
         ON CONFLICT (denomination) DO UPDATE
           SET stock_total = EXCLUDED.stock_total,
               stock_reserved = 0, stock_delivered = 0, stock_rejected = 0,
               updated_at = now()`,
        [c.denomination, c.stockTotal],
      );
    }
  }
}
