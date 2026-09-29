"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const pg_bootstrap_1 = require("./db/pg-bootstrap");
async function bootstrap() {
    await (0, pg_bootstrap_1.ensurePostgres)();
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { cors: true });
    app.setGlobalPrefix('api');
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port, '0.0.0.0');
    // eslint-disable-next-line no-console
    console.log(`现金服务中心 API: http://127.0.0.1:${port}/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map