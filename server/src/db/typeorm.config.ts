import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DEFAULT_PG_CONFIG, PgRuntimeConfig } from './pg-bootstrap';
import { SnakeNamingStrategy } from './snake-naming.strategy';
import { Cassette } from '../cash/entities/cassette.entity';
import { CashRequest } from '../cash/entities/cash-request.entity';
import { CashLine } from '../cash/entities/cash-line.entity';
import { CashAudit } from '../cash/entities/cash-audit.entity';

export function typeOrmOptions(cfg: PgRuntimeConfig = DEFAULT_PG_CONFIG): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: process.env.PG_HOST ?? '127.0.0.1',
    port: cfg.port,
    username: cfg.user,
    password: cfg.password,
    database: cfg.database,
    entities: [Cassette, CashRequest, CashLine, CashAudit],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: true,
  };
}
