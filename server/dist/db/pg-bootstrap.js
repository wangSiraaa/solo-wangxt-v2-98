"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PG_CONFIG = void 0;
exports.ensurePostgres = ensurePostgres;
exports.stopPostgres = stopPostgres;
const module_1 = require("module");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pg_1 = require("pg");
// embedded-postgres 仅提供 ESM 入口，CJS 下用 createRequire 加载其默认导出
const localRequire = (0, module_1.createRequire)(__filename);
const EmbeddedPostgres = localRequire('embedded-postgres').default;
exports.DEFAULT_PG_CONFIG = {
    port: Number(process.env.PG_PORT ?? 55432),
    user: 'cash',
    password: 'cash',
    database: 'cashcenter',
    dataDir: process.env.PG_DATA_DIR ?? path.join(process.cwd(), '.pgdata'),
};
let instance = null;
/**
 * 启动进程内真实 PostgreSQL（embedded-postgres 封装的官方 postgres 二进制，非 mock）。
 * 幂等：重复调用复用同一实例。PG_EXTERNAL=1 时跳过（连接外部库）。
 */
async function ensurePostgres(cfg = exports.DEFAULT_PG_CONFIG) {
    if (process.env.PG_EXTERNAL === '1')
        return cfg;
    if (instance)
        return cfg;
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
    const admin = new pg_1.Client({
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
        if (exists.rowCount === 0)
            await admin.query(`CREATE DATABASE ${cfg.database}`);
    }
    finally {
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
async function stopPostgres() {
    if (instance) {
        await instance.stop();
        instance = null;
    }
}
//# sourceMappingURL=pg-bootstrap.js.map