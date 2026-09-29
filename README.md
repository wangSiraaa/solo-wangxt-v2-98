# 现金服务中心 · 有限钞箱配钞模拟器

在**有限钞箱余量**下为一批模拟取款申请配钞的全栈演示：

- **web/** — Vue 3 + Vite：展示面额库存、多个可行组合、不可行解释、计划/预占/实际出钞三阶段与账实核对
- **server/** — NestJS 10 + TypeORM：有界整数（金额单位：**分**）找零规划、PostgreSQL 事务预占、出钞回报与核对
- **PostgreSQL** — 使用 `embedded-postgres` 启动的**真实官方 PostgreSQL 17 二进制**（非 mock、非 SQLite），数据落在 `server/.pgdata/`；也可用 `PG_EXTERNAL=1` 连接外部库

> 不连接任何真实 ATM。出钞结果由模拟器回报，系统严格区分
> **计划可行 ≠ 预占成功 ≠ 现金已交付**：只有 `delivered_*` 字段代表真的出了钞。

## 快速开始

```bash
npm install                 # 安装 workspaces 依赖（首次会下载 PG 二进制）
npm run dev:server          # 终端 1：启动 NestJS（自动 initdb/启动内嵌 PG），:3000
npm run dev:web             # 终端 2：启动 Vite，:5173（/api 代理到 :3000）
```

打开 http://127.0.0.1:5173 ，点击「样例：小面额不足」或「样例：批内竞争」即可走完整流程。

其他命令：

```bash
npm test                    # 算法单测（含 200 个随机实例与暴力枚举对照）
npm run verify              # 端到端脚本验证（真实 PG + 事务 + 三态出钞 + 核对）
node server/scripts/http-flow.mjs   # 需先起服务；走真实 HTTP 的全流程联调
npm run build               # 构建前后端
```

连接外部 PostgreSQL：

```bash
PG_EXTERNAL=1 PG_HOST=... PG_PORT=5432 ... npm run dev:server
```

## 业务流程（三阶段，状态严格分离）

```
① 计划 plan            ② 预占 reserve（DB 事务）      ③ 出钞 dispense（模拟器回报）
读取库存快照            SELECT ... FOR UPDATE           success → dispensed（足额）
有界整数 DP 选组合      逐面额校验、扣减 remaining       reject  → failed（全额回补）
写 cash_request/line   写 cash_audit（reserve）        partial → partial（未完成回补）
       不扣库存！        allOrNothing 失败整批回滚        只有 delivered_* 才算交付
```

钞箱数量恒等式（核对接口逐项检查）：

```
初始张数 = 现存张数 + 预占未出张数 + 已出张数
现存张数 = 审计流水净额（reset + reserve - 回补）
初始价值 = 现存价值 + 预占价值 + 已交付价值
```

## 配钞算法（有界整数，无浮点）

- 金额全部为**整数分**（`Uint32Array` DP，`0xffffffff` 表示不可达）；入参拒绝非整数
- 每种面额有库存上界，用**单调队列优化的有界背包** O(target) 求最少/最多张数表（按面额模 d 的剩余类）
- 按后缀面额建 min/max 表，枚举方案时以「后缀能否**恰好**用 budget 张凑出」剪枝
  （可行张数构成公差 `gcd(当前面额, 后缀面额gcd)/当前面额` 的等差数列）
- 最多枚举 5 个不同组合，按**总张数升序**返回；0 号推荐组合即张数最少（大面额优先）
- 不可行时给出具体原因分类：
  - `DENOMINATION_GAP`：面额 gcd 无法整除金额，报告余数（「还差 200 分」）
  - `INSUFFICIENT_STOCK`：无限库存可行但实际库存不够，报告**最大可达金额、缺口、被用尽的面额**
  - `NOTE_LIMIT`：最少需要的张数超过单笔上限
  - `DENOMINATION_SET` / `EMPTY_DENOMINATION`：面额集合本身无法构成 / 无可用面额

## 验证样例（默认库存：¥1×8、¥2×12、¥5×30、¥10×40）

**小面额不足**（页面一键填充）：

| 申请 | 金额 | 允许面额 | 结果 |
|---|---|---|---|
| A1 | ¥86 | 全部 | 可行，5 个组合；推荐 10×8+5+1 = 10 张 |
| A2 | ¥27 | ¥10/¥5 | 不可行：gcd=500，2700 余 200，「低于该金额最近可凑 ¥25，还差 200 分」 |
| A3 | ¥32 | ¥5/¥2/¥1 | 可行：恰好把 ¥2×12 与 ¥1×8 全部占满（200×12+100×8=3200） |

**多组合**：¥86 在全部面额下枚举 5 个组合（10 张 1 个、11 张 2 个、12 张 2 个），
每组合金额精确等于 8600 分，页面逐面额展示占用张数。

**批内竞争 + 事务**：C1 ¥86（推荐组合占用 ¥1×1）与 C2 ¥8（仅允许 ¥1，需 8 张）
各自计划都可行；一起预占时 C2 只剩 7 张：

- `allOrNothing=true`（默认）→ 整个事务回滚，**C1 的扣减也撤销**，两笔回到「仅计划」
- `allOrNothing=false` → 每笔一个 savepoint，C1 预占成功、C2 失败并返回原因

**出钞三态**（预占成功后模拟）：

- 足额出钞：`delivered = reserved`，状态 `dispensed`
- 全部拒钞：预占**全额回补**库存，`delivered=0`，状态 `failed`
- 部分未完成：如预占 ¥10×5 只吐出 3 张，交付 3000 分，2 张回补，状态 `partial`，
  页面明确标注「未完成 ¥20（不能视为已交付）」

`npm run verify` 对以上场景输出 38 项自动核对（库存守恒、审计流水、钞箱口径与申请口径对账等）。

## 数据模型

| 表 | 含义 |
|---|---|
| `cassette` | 钞箱：面额、初始/现存/已出张数 |
| `cash_request` | 申请：金额（分）、允许面额、张数上限、计划状态、预占状态、已交付金额/张数 |
| `cash_line` | 组合明细：组合序号、面额、计划/预占/实出张数、是否选中 |
| `cash_audit` | 库存变动流水：预占为负、回补为正，reset 留痕，供守恒核对 |

## HTTP API（前缀 `/api`）

| 方法 路径 | 说明 |
|---|---|
| `GET /cassettes` | 钞箱现状 |
| `POST /cassettes/reset` | 重置（清库/计划/审计，重新配钞） |
| `POST /plans/batch` | 一批申请生成计划（REPEATABLE READ 快照，不扣库存） |
| `POST /reserve/batch` | 事务预占：`{ids, allOrNothing, optionByRequest?}` |
| `POST /requests/:id/dispense` | 模拟器回报：`{outcome: success/reject/partial, delivered?}` |
| `GET /requests` | 全部申请（含组合行） |
| `GET /reconcile` | 账实核对报告 |
