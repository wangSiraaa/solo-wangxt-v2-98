"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DbService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbService = exports.ALL_DENOMINATIONS = exports.DEFAULT_CASSETTES = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const entities_1 = require("./entities");
/** 默认钞箱种子数据（张）。1 元刻意只放 3 张，便于演示“小面额不足”。 */
exports.DEFAULT_CASSETTES = [
    { denomination: 100, stockTotal: 40 },
    { denomination: 50, stockTotal: 20 },
    { denomination: 20, stockTotal: 50 },
    { denomination: 10, stockTotal: 60 },
    { denomination: 5, stockTotal: 50 },
    { denomination: 1, stockTotal: 3 },
];
exports.ALL_DENOMINATIONS = exports.DEFAULT_CASSETTES.map((c) => c.denomination);
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
let DbService = DbService_1 = class DbService {
    logger = new common_1.Logger(DbService_1.name);
    dataSource;
    constructor() {
        this.dataSource = new typeorm_1.DataSource({
            type: 'postgres',
            host: process.env.PGHOST || '127.0.0.1',
            port: Number(process.env.PGPORT || 5432),
            username: process.env.PGUSER || 'cashapp',
            password: process.env.PGPASSWORD || '',
            database: process.env.PGDATABASE || 'cashcenter',
            entities: [entities_1.CassetteEntity, entities_1.ReservationEntity, entities_1.BatchEntity],
            synchronize: false,
            logging: false,
        });
    }
    async onModuleInit() {
        await this.dataSource.initialize();
        this.logger.log('PostgreSQL 连接已建立');
        await this.dataSource.query(SCHEMA_SQL);
        await this.seedIfEmpty();
    }
    async seedIfEmpty() {
        const count = await this.dataSource.query('SELECT count(*)::int AS n FROM cassettes');
        if (Number(count[0].n) === 0) {
            for (const c of exports.DEFAULT_CASSETTES) {
                await this.dataSource.query(`INSERT INTO cassettes (denomination, stock_total)
           VALUES ($1, $2)`, [c.denomination, c.stockTotal]);
            }
            this.logger.log('钞箱种子数据已写入');
        }
    }
    /** 测试/运维：清空业务数据并重置钞箱（用于可重复的核对演示） */
    async reset(cassettes) {
        await this.dataSource.query('TRUNCATE reservations RESTART IDENTITY');
        await this.dataSource.query('TRUNCATE batches RESTART IDENTITY CASCADE');
        const seed = cassettes && cassettes.length > 0 ? cassettes : exports.DEFAULT_CASSETTES;
        for (const c of seed) {
            await this.dataSource.query(`INSERT INTO cassettes (denomination, stock_total, stock_reserved, stock_delivered, stock_rejected)
         VALUES ($1, $2, 0, 0, 0)
         ON CONFLICT (denomination) DO UPDATE
           SET stock_total = EXCLUDED.stock_total,
               stock_reserved = 0, stock_delivered = 0, stock_rejected = 0,
               updated_at = now()`, [c.denomination, c.stockTotal]);
        }
    }
};
exports.DbService = DbService;
exports.DbService = DbService = DbService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DbService);
