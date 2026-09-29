"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeOrmOptions = typeOrmOptions;
const pg_bootstrap_1 = require("./pg-bootstrap");
const snake_naming_strategy_1 = require("./snake-naming.strategy");
const cassette_entity_1 = require("../cash/entities/cassette.entity");
const cash_request_entity_1 = require("../cash/entities/cash-request.entity");
const cash_line_entity_1 = require("../cash/entities/cash-line.entity");
const cash_audit_entity_1 = require("../cash/entities/cash-audit.entity");
function typeOrmOptions(cfg = pg_bootstrap_1.DEFAULT_PG_CONFIG) {
    return {
        type: 'postgres',
        host: process.env.PG_HOST ?? '127.0.0.1',
        port: cfg.port,
        username: cfg.user,
        password: cfg.password,
        database: cfg.database,
        entities: [cassette_entity_1.Cassette, cash_request_entity_1.CashRequest, cash_line_entity_1.CashLine, cash_audit_entity_1.CashAudit],
        namingStrategy: new snake_naming_strategy_1.SnakeNamingStrategy(),
        synchronize: true,
    };
}
//# sourceMappingURL=typeorm.config.js.map