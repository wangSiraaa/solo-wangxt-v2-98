/** 类型垫片：embedded-postgres 是纯 ESM（exports 无 require 条件），
 * 在 CommonJS/moduleResolution=node 下用 createRequire 加载，类型在此声明。 */
declare module 'embedded-postgres' {
  export interface PostgresOptions {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
  }
  export default class EmbeddedPostgres {
    constructor(options?: Partial<PostgresOptions>);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getPgClient(database?: string, host?: string): import('pg').Client;
  }
}
