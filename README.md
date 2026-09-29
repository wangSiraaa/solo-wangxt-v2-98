# 现金配钞模拟中心（Cash Center Simulator）

在**有限钞箱余量**下为一批模拟取款申请配钞的完整演示系统，**不连接真实 ATM**：

- **Vue 3**：展示面额库存（可用/预占/已出钞/拒钞四口径）、可行组合与无解解释、批次计划/预占/实际结果三段视图与核对面板；
- **NestJS**：用**有界整数算法**（分层封顶可行解计数 DP + 对角线滑动窗口）选择配钞组合，整批预占放在**单个 PostgreSQL 事务**内完成（行锁 + 条件更新，防并发超卖）；
- **PostgreSQL**：保存钞箱、批次、逐笔预占与出钞回报。

> 核心口径：**计划可行 ≠ 预占成功 ≠ 现金已交付**。现金交付只以结算后的“实际交付（delivered）”数量为准；模拟器返回成功 / 拒钞 / 未完成三种结果，拒钞入回收箱、未完成数量释放回可用库存。

## 目录结构

```
packages/
  server/                 NestJS + TypeORM + pg
    src/solver/
      bounded-solver.ts   有界整数配钞算法（纯函数，无浮点）
      solver-test.ts      与暴力枚举对照的算法测试（1500 组随机用例）
    src/db/               数据源、建表 DDL、实体、种子钞箱
    src/cash/             计划 / 事务预占 / 模拟出钞 / 核对 服务与控制器
  web/                    Vue 3 + Vite 前端
scripts/
  verify.mjs              端到端核对验证（51 项断言）
  pg-local-start.sh       无 root/docker 时，用户态启动真实 PostgreSQL 15
docker-compose.yml        有 docker 时直接起官方 postgres:15
```

## 快速开始

### 1) 准备 PostgreSQL

二选一：

```bash
# A. 有 Docker
docker compose up -d

# B. 无 root / 无 Docker（Debian 系，脚本自动下载官方二进制并在 /tmp 初始化）
./scripts/pg-local-start.sh     # 监听 127.0.0.1:5433, 库名 cashcenter, 信任认证
```

### 2) 启动后端

```bash
npm install
# Docker 方式（默认 5432）
npm run dev:server        # 或 npm run build && npm run start:server
# 用户态 PG（5433 + unix socket）
PGHOST=/tmp/pgrun PGPORT=5433 npm run start:server
```

### 3) 启动前端

```bash
npm run dev:web           # http://127.0.0.1:5173 ，/api 自动代理到 3000
```

页面初始钞箱（种子数据，**1 元钞箱刻意只有 3 张**以演示小面额不足）：

| 面额 | 100 | 50 | 20 | 10 | 5 | 1 |
|---|---|---|---|---|---|---|
| 张数 | 40 | 20 | 50 | 60 | 50 | **3** |

## 配钞算法（有界整数，全程整数运算）

给定面额 `d[i]`、钞箱余量 `stock[i]`、目标金额 `A`、单笔张数上限 `L`，求非负整数 `x[i]`：

```
Σ d[i]·x[i] = A,   0 ≤ x[i] ≤ stock[i],   Σ x[i] ≤ L
```

- **分层 DP**，层形状 `(A+1)×(L+1)`，状态值为**封顶可行解数**（Uint8，255 表示“≥255 种组合”，用饱和计数规避加法下溢）；
- 每层转移是有界数量求和 `Σ_{q=0..stock[i]} prev[a−q·d, k−q]`，沿对角线 `a−k·d=const` 做**定长滑动窗口**，整体 **O(n·A·L)**；
- **组合重建**从大面额贪心取最大可行张数（张数最少），并在主路径各层扫描“次大可行分叉”构造一个不同的备选组合；
- 无解时给出结构化解释：总价值不足 / 金额不被面额 gcd 整除 / 张数上限挡死 / **小面额找零不足（贪心尾差 + 精确计 DP 的最大可达金额与缺口）**。

算法在 `src/solver/solver-test.ts` 中与**暴力枚举**对拍（可行性、最少张数、备选差异、组合计数），1500 组随机用例全部一致：

```bash
cd packages/server
npx tsc src/solver/bounded-solver.ts src/solver/solver-test.ts --outDir /tmp/t --target ES2022 --module commonjs --strict --skipLibCheck
node /tmp/t/solver-test.js      # cases=1500 failures=0
```

## 业务流程与数据一致性

1. **计划（`POST /api/plan`）**：纯计算，逐笔返回可行组合（主/备选、各面额占用数量）或无解解释；不落库、不占库存。
2. **预占（`POST /api/reserve`）**：服务端**重算计划**（不信前端），在**单个事务**内：
   - 按面额升序 `SELECT … FOR UPDATE` 锁全部钞箱行（固定加锁顺序防死锁）；
   - 累计本批需求逐面额校验余量，任何一笔不可行即抛错，**整批回滚**；
   - 通过后执行带余量条件的原子增量更新：
     `UPDATE … SET stock_reserved = stock_reserved + n WHERE … AND 可用 ≥ n`（更新 0 行即回滚，**并发也绝不超卖**）。
3. **模拟出钞（`POST /api/batches/:id/dispense`）**：逐笔独立事务、确定性伪随机（按预占 id 播种，结果可复现）：
   - `success` 全部成功；`reject` 全部拒钞；`shortage` 按比例“钞箱抽空”产生未完成；`simulate` 按拒钞率逐张判定；
   - 结算把预占转为 `delivered / rejected`，未完成张数仅解除预占、**退回可用库存**；
   - 状态 `DISPENSED / PARTIAL / FAILED`，并保存逐笔回报文本。
4. **核对（`GET /api/reconciliation`）**：
   - 不变式 `可用 = 总量 − 预占 − 已出钞 − 拒钞 ≥ 0`（DB 层还有 CHECK 约束兜底）；
   - 未结算预占按面额汇总必须等于钞箱 `stock_reserved`；
   - 每笔守恒 `计划金额 = 实际交付 + 拒钞 + 未完成`；价值总守恒。

## 验证结果

端到端核对脚本（对运行中的真实服务 + PostgreSQL 发真实 HTTP 请求）：

```bash
npm run verify        # 51 通过, 0 失败
```

覆盖：

- **小面额不足**：97 元可行；99/104 元无解（需 4 张 1 元、仅 3 张），明确报告“最多凑到 103 元、只差 1 元”；含 104 元的批次**整批回滚且库存逐张不变**；
- **多个可行组合**：100 元有 `100×1 / 50×2 / 20×5…`，主组合（张数最少）与备选不同且都精确等于金额；批次预占/出钞后钞箱减量逐面额等于计划张数；
- **拒钞 / 未完成**：全部拒钞时 HTTP 成功但交付为 0（`FAILED`）；未完成张数释放回可用（较预占时刻回升）；
- **并发争抢**：两个各需 30 张 100 元（库存 40）的批次并发提交，恰有一个成功、另一个整批回滚，`reserved` 恰为 30、`available` 恰为 10。

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cassettes` | 钞箱四口径库存 |
| POST | `/api/evaluate` | 单笔试算（不写库） |
| POST | `/api/plan` | 一批申请生成计划 |
| POST | `/api/reserve` | 整批单事务预占（失败整体回滚） |
| POST | `/api/batches/:id/dispense` | 模拟出钞并结算 |
| GET | `/api/batches/:id` | 批次与逐笔预占/回报 |
| GET | `/api/reconciliation` | 库存与结果核对 |
| POST | `/api/admin/reset` | 重置演示数据 |
