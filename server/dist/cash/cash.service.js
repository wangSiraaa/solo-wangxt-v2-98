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
var CashService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashService = exports.DEFAULT_CASSETTES = exports.ConflictError = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const cassette_entity_1 = require("./entities/cassette.entity");
const cash_request_entity_1 = require("./entities/cash-request.entity");
const cash_line_entity_1 = require("./entities/cash-line.entity");
const planner_service_1 = require("./planner.service");
const dto_1 = require("./dto");
class ConflictError extends Error {
    details;
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
/** 预置初始钞箱：小面额偏紧（¥1 只有 8 张、¥2 只有 12 张） */
exports.DEFAULT_CASSETTES = [
    { denomination: 100, count: 8 },
    { denomination: 200, count: 12 },
    { denomination: 500, count: 30 },
    { denomination: 1000, count: 40 },
];
let CashService = CashService_1 = class CashService {
    dataSource;
    planner;
    logger = new common_1.Logger(CashService_1.name);
    constructor(dataSource, planner) {
        this.dataSource = dataSource;
        this.planner = planner;
    }
    async onModuleInit() {
        await this.reset(exports.DEFAULT_CASSETTES, true);
    }
    // ---------------- 库存 ----------------
    async listCassettes() {
        const rows = await this.dataSource.getRepository(cassette_entity_1.Cassette).find({
            order: { denomination: 'ASC' },
        });
        return rows.map((c) => ({
            denomination: c.denomination,
            initialCount: c.initialCount,
            remainingCount: c.remainingCount,
            deliveredCount: c.deliveredCount,
            remainingValueCents: c.remainingCount * c.denomination,
        }));
    }
    /** 清库+重新配钞；审计与申请一并清空，保证核对基准干净 */
    async reset(cassettes, silent = false) {
        if (!Array.isArray(cassettes) || cassettes.length === 0) {
            throw new dto_1.BadInput('cassettes 必须是非空数组');
        }
        const norm = cassettes.map((c, i) => ({
            denomination: (0, dto_1.assertPosInt)(c?.denomination, `cassettes[${i}].denomination`),
            count: (0, dto_1.assertNonNegInt)(c?.count, `cassettes[${i}].count`),
        }));
        await this.dataSource.transaction(async (em) => {
            await em.query('TRUNCATE TABLE cash_audit, cash_line, cash_request, cassette RESTART IDENTITY CASCADE');
            for (const c of norm) {
                await em.query(`INSERT INTO cassette (denomination, initial_count, remaining_count, delivered_count)
           VALUES ($1, $2, $2, 0)`, [c.denomination, c.count]);
                await em.query(`INSERT INTO cash_audit (denomination, delta_count, kind, note)
           VALUES ($1, $2, 'reset', '初始配钞')`, [c.denomination, c.count]);
            }
        });
        if (!silent)
            this.logger.log('钞箱已重置');
    }
    // ---------------- 第一步：生成计划（不预占库存） ----------------
    /**
     * 一批申请共用一个 REPEATABLE READ 快照出计划。
     * 注意：计划只是“在当前库存下可行”，不等于现金已交付，甚至不等于已预占。
     */
    async planBatch(input) {
        const maxSolutions = Math.min(Math.max(1, Number(input?.maxSolutions ?? 5) || 5), 5);
        const requests = (input.requests ?? []).map((r, i) => (0, dto_1.normalizePlanRequest)(r, i));
        if (requests.length === 0)
            throw new dto_1.BadInput('requests 不能为空');
        const refs = requests.map((r) => r.clientRef);
        if (new Set(refs).size !== refs.length) {
            throw new dto_1.BadInput(`批内 clientRef 必须唯一：${refs.join(', ')}`);
        }
        const saved = await this.dataSource.transaction('REPEATABLE READ', async (em) => {
            const result = [];
            for (const dto of requests) {
                const stocks = await this.readStocks(em, dto.allowedDenominations);
                const plan = this.planner.plan(dto.amountCents, stocks, dto.maxNotes, maxSolutions);
                result.push(await this.persistPlan(em, dto, plan));
            }
            return result;
        });
        return this.reloadWithLines(saved.map((r) => r.id));
    }
    async readStocks(em, denoms) {
        const rows = await em.query(`SELECT denomination, remaining_count FROM cassette
       WHERE denomination = ANY($1) ORDER BY denomination ASC`, [denoms]);
        // 用户允许但系统没有钞箱的面额：available=0 也要参与解释
        const map = new Map(rows.map((r) => [Number(r.denomination), Number(r.remaining_count)]));
        return [...new Set(denoms)].map((d) => ({
            denomination: d,
            available: map.get(d) ?? 0,
        }));
    }
    async persistPlan(em, dto, plan) {
        const req = em.create(cash_request_entity_1.CashRequest, {
            clientRef: dto.clientRef,
            amount: dto.amountCents,
            allowedDenominations: dto.allowedDenominations,
            maxNotes: dto.maxNotes,
            planStatus: plan.feasible ? 'feasible' : 'infeasible',
            reason: plan.feasible ? null : plan.reason.message,
            optionCount: plan.solutions.length,
            reserveStatus: 'none',
            deliveredCents: 0,
            deliveredNotes: 0,
            reservedCents: 0,
        });
        await em.save(req);
        for (const sol of plan.solutions) {
            for (const line of sol.lines) {
                await em.save(em.create(cash_line_entity_1.CashLine, {
                    requestId: req.id,
                    optionIndex: sol.optionIndex,
                    denomination: line.denomination,
                    plannedCount: line.count,
                    reservedCount: 0,
                    deliveredCount: 0,
                    picked: false,
                }));
            }
        }
        return req;
    }
    async reloadWithLines(ids) {
        if (ids.length === 0)
            return [];
        const rows = await this.dataSource.query(`SELECT * FROM cash_request WHERE id = ANY($1)
       ORDER BY created_at ASC, client_ref ASC`, [ids]);
        return this.hydrate(rows);
    }
    async hydrate(rows) {
        if (rows.length === 0)
            return [];
        const ids = rows.map((r) => r.id);
        const lineRows = await this.dataSource.query(`SELECT * FROM cash_line WHERE request_id = ANY($1)
       ORDER BY option_index ASC, denomination DESC`, [ids]);
        const byReq = new Map();
        for (const lr of lineRows) {
            const list = byReq.get(lr.request_id) ?? [];
            list.push(this.toLineEntity(lr));
            byReq.set(lr.request_id, list);
        }
        return rows.map((r) => {
            const req = this.toRequestEntity(r);
            req.lines = byReq.get(req.id) ?? [];
            return req;
        });
    }
    toRequestEntity(r) {
        const req = new cash_request_entity_1.CashRequest();
        req.id = r.id;
        req.clientRef = r.client_ref;
        req.amount = Number(r.amount);
        req.allowedDenominations = r.allowed_denominations.map(Number);
        req.maxNotes = Number(r.max_notes);
        req.planStatus = r.plan_status;
        req.reason = r.reason;
        req.optionCount = Number(r.option_count);
        req.reserveStatus = r.reserve_status;
        req.deliveredCents = Number(r.delivered_cents);
        req.deliveredNotes = Number(r.delivered_notes);
        req.reservedCents = Number(r.reserved_cents);
        req.createdAt = r.created_at;
        return req;
    }
    toLineEntity(r) {
        const l = new cash_line_entity_1.CashLine();
        l.id = r.id;
        l.requestId = r.request_id;
        l.optionIndex = Number(r.option_index);
        l.denomination = Number(r.denomination);
        l.plannedCount = Number(r.planned_count);
        l.reservedCount = Number(r.reserved_count);
        l.deliveredCount = Number(r.delivered_count);
        l.picked = r.picked;
        return l;
    }
    async listRequests() {
        const rows = await this.dataSource.query(`SELECT * FROM cash_request ORDER BY created_at ASC, client_ref ASC`);
        return this.hydrate(rows);
    }
    // ---------------- 第二步：事务预占 ----------------
    /**
     * 对一批申请预占库存。一个数据库事务、按面额顺序锁行，避免死锁。
     * allOrNothing=true（默认）：任一申请预占失败，整批回滚（请求成功 ≠ 现金交付）。
     * allOrNothing=false：每笔一个 savepoint，失败的跳过并记录原因，成功的提交。
     */
    async reserveBatch(ids, options = {}) {
        const allOrNothing = options.allOrNothing ?? true;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new dto_1.BadInput('ids 必须是非空数组');
        }
        const failed = [];
        const reserved = [];
        try {
            await this.dataSource.transaction(async (em) => {
                // 一次锁住所有相关钞箱（面额升序，固定加锁顺序）
                await em.query(`SELECT denomination, remaining_count FROM cassette ORDER BY denomination ASC FOR UPDATE`);
                for (const id of ids) {
                    const sp = `sp_${this.safeId(id)}`;
                    if (!allOrNothing)
                        await em.query(`SAVEPOINT ${sp}`);
                    try {
                        const picked = await this.reserveOne(em, id, options.optionByRequest?.[id] ?? 0);
                        reserved.push(picked.id);
                        if (!allOrNothing)
                            await em.query(`RELEASE SAVEPOINT ${sp}`);
                    }
                    catch (e) {
                        if (allOrNothing)
                            throw e;
                        // 先回滚到 savepoint（释放嵌套事务内的所有锁与改动），再 RELEASE 同名点
                        await em.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                        await em.query(`RELEASE SAVEPOINT ${sp}`);
                        const reason = e instanceof Error ? e.message : String(e);
                        const m = reason.match(/^\[([^\]]+)\]/);
                        failed.push({ id, clientRef: m ? m[1] : id, reason });
                    }
                }
            });
        }
        catch (e) {
            if (allOrNothing && e instanceof Error && e.name === 'ReserveAbort') {
                throw new ConflictError('整批预占已回滚：' + e.message, {
                    reason: e.message,
                    aborted: true,
                });
            }
            throw e;
        }
        return { reserved, failed };
    }
    safeId(id) {
        return id.replace(/[^a-zA-Z0-9]/g, '');
    }
    async reserveOne(em, id, optionIndex) {
        const rows = await em.query(`SELECT * FROM cash_request WHERE id = $1 FOR UPDATE`, [id]);
        if (rows.length === 0)
            throw new dto_1.BadInput(`申请 ${id} 不存在`);
        const req = this.toRequestEntity(rows[0]);
        if (req.planStatus === 'infeasible') {
            throw this.abort(`[${req.clientRef}] 计划不可行，不能预占：${req.reason}`);
        }
        if (req.reserveStatus === 'reserved') {
            throw this.abort(`[${req.clientRef}] 已预占，不能重复预占`);
        }
        if (req.reserveStatus !== 'none') {
            throw this.abort(`[${req.clientRef}] 状态为 ${req.reserveStatus}，预占通道已关闭`);
        }
        const lineRows = await em.query(`SELECT * FROM cash_line WHERE request_id = $1 AND option_index = $2 ORDER BY denomination ASC`, [id, optionIndex]);
        if (lineRows.length === 0) {
            throw this.abort(`[${req.clientRef}] 不存在第 ${optionIndex} 号组合`);
        }
        // 逐面额校验库存（行锁已在事务开始时获取）
        const shortages = [];
        for (const lr of lineRows) {
            const need = Number(lr.planned_count);
            const c = await em.query(`SELECT remaining_count FROM cassette WHERE denomination = $1`, [Number(lr.denomination)]);
            const have = Number(c[0].remaining_count);
            if (have < need) {
                shortages.push(`${lr.denomination}分面额需 ${need} 张、仅剩 ${have} 张`);
            }
        }
        if (shortages.length > 0) {
            throw this.abort(`[${req.clientRef}] 库存不足：${shortages.join('；')}`);
        }
        // 扣减 + 落预占 + 审计，全部在同一事务内
        for (const lr of lineRows) {
            const need = Number(lr.planned_count);
            await em.query(`UPDATE cassette SET remaining_count = remaining_count - $1, updated_at = now()
         WHERE denomination = $2`, [need, Number(lr.denomination)]);
            await em.query(`UPDATE cash_line SET reserved_count = $1, picked = true WHERE id = $2`, [need, lr.id]);
            await em.query(`INSERT INTO cash_audit (denomination, delta_count, kind, request_id, note)
         VALUES ($1, $2, 'reserve', $3, $4)`, [
                Number(lr.denomination),
                -need,
                id,
                `预占 ${req.clientRef} 组合#${optionIndex}`,
            ]);
        }
        // 同一申请的其他组合标记为未选中
        await em.query(`UPDATE cash_line SET picked = false WHERE request_id = $1 AND option_index <> $2`, [id, optionIndex]);
        await em.query(`UPDATE cash_request SET reserve_status = 'reserved', reserved_cents = $1 WHERE id = $2`, [req.amount, id]);
        return req;
    }
    abort(message) {
        return Object.assign(new Error(message), { name: 'ReserveAbort' });
    }
    // ---------------- 第三步：模拟器出钞 ----------------
    /**
     * 模拟 ATM 出钞。绝不把“请求/预占成功”当作现金交付：
     * 只有 deliveredCount 增加才代表真的出了钞。
     *  - success：全部预占张数出钞
     *  - reject ：全部拒钞，预占回补库存
     *  - partial：按 delivered（面额->张数）出钞，其余回补；必须有钞出、且不足额
     */
    async dispense(id, outcome, delivered) {
        if (!['success', 'reject', 'partial'].includes(outcome)) {
            throw new dto_1.BadInput(`未知出钞结果：${String(outcome)}`);
        }
        await this.dataSource.transaction(async (em) => {
            await em.query(`SELECT denomination FROM cassette ORDER BY denomination ASC FOR UPDATE`);
            const rows = await em.query(`SELECT * FROM cash_request WHERE id = $1 FOR UPDATE`, [id]);
            if (rows.length === 0)
                throw new dto_1.BadInput(`申请 ${id} 不存在`);
            const req = this.toRequestEntity(rows[0]);
            if (req.reserveStatus !== 'reserved') {
                throw new ConflictError(`[${req.clientRef}] 当前状态 ${req.reserveStatus}，只有“已预占”可以出钞`);
            }
            const lineRows = await em.query(`SELECT * FROM cash_line WHERE request_id = $1 AND picked = true ORDER BY denomination ASC`, [id]);
            let deliveredMap = new Map();
            if (outcome === 'success') {
                for (const lr of lineRows)
                    deliveredMap.set(Number(lr.denomination), Number(lr.reserved_count));
            }
            else if (outcome === 'reject') {
                for (const lr of lineRows)
                    deliveredMap.set(Number(lr.denomination), 0);
            }
            else {
                deliveredMap = this.parsePartial(delivered, lineRows.map((l) => Number(l.denomination)), req);
            }
            let deliveredCents = 0;
            let deliveredNotes = 0;
            for (const lr of lineRows) {
                const d = Number(lr.denomination);
                const reserved = Number(lr.reserved_count);
                const got = deliveredMap.get(d) ?? 0;
                if (got < 0 || got > reserved) {
                    throw new dto_1.BadInput(`[${req.clientRef}] ${d} 分面额回报 ${got} 张超出预占 [0,${reserved}]`);
                }
                const refund = reserved - got;
                deliveredCents += got * d;
                deliveredNotes += got;
                if (got > 0) {
                    await em.query(`UPDATE cassette SET delivered_count = delivered_count + $1 WHERE denomination = $2`, [got, d]);
                }
                if (refund > 0) {
                    await em.query(`UPDATE cassette SET remaining_count = remaining_count + $1 WHERE denomination = $2`, [refund, d]);
                    // 拒钞与“部分出钞中未完成的部分”是两种语义，审计只记一条
                    const kind = outcome === 'reject' ? 'dispense-reject' : 'dispense-partial-refund';
                    const note = outcome === 'reject'
                        ? `拒钞回补 ${req.clientRef}`
                        : `未完成回补 ${req.clientRef}`;
                    await em.query(`INSERT INTO cash_audit (denomination, delta_count, kind, request_id, note)
             VALUES ($1, $2, $3, $4, $5)`, [d, refund, kind, id, note]);
                }
                await em.query(`UPDATE cash_line SET delivered_count = $1 WHERE id = $2`, [got, lr.id]);
            }
            if (outcome === 'partial' && deliveredCents >= req.amount) {
                throw new dto_1.BadInput(`[${req.clientRef}] 部分出钞金额不能达到或超过计划金额`);
            }
            const newStatus = outcome === 'success'
                ? 'dispensed'
                : outcome === 'reject'
                    ? 'failed'
                    : 'partial';
            await em.query(`UPDATE cash_request
         SET reserve_status = $1, delivered_cents = $2, delivered_notes = $3 WHERE id = $4`, [newStatus, deliveredCents, deliveredNotes, id]);
        });
        const [reloaded] = await this.reloadWithLines([id]);
        return reloaded;
    }
    parsePartial(delivered, denoms, req) {
        if (!delivered || typeof delivered !== 'object') {
            throw new dto_1.BadInput(`[${req.clientRef}] partial 必须提供 delivered（面额->实际张数）`);
        }
        const map = new Map();
        for (const [key, val] of Object.entries(delivered)) {
            const d = Number(key);
            if (!denoms.includes(d)) {
                throw new dto_1.BadInput(`[${req.clientRef}] 回报了未预占的面额 ${d}`);
            }
            if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
                throw new dto_1.BadInput(`[${req.clientRef}] ${d} 分面额回报张数必须是非负整数`);
            }
            map.set(d, val);
        }
        const total = [...map.values()].reduce((a, b) => a + b, 0);
        if (total === 0) {
            throw new dto_1.BadInput(`[${req.clientRef}] partial 至少要有 1 张实际出钞（全拒请用 reject）`);
        }
        return map;
    }
    // ---------------- 核对 ----------------
    async reconcile() {
        return this.dataSource.transaction(async (em) => {
            const cassettes = await em.query(`SELECT denomination, initial_count, remaining_count, delivered_count
         FROM cassette ORDER BY denomination ASC`);
            const audit = await em.query(`SELECT denomination, SUM(delta_count)::int AS delta
         FROM cash_audit GROUP BY denomination`);
            const requests = await em.query(`SELECT id, client_ref, amount, reserve_status, reserved_cents, delivered_cents, delivered_notes
         FROM cash_request ORDER BY created_at ASC`);
            const lineRows = await em.query(`SELECT request_id, denomination,
                SUM(planned_count)::int AS planned,
                SUM(reserved_count)::int AS reserved,
                SUM(delivered_count)::int AS delivered
         FROM cash_line GROUP BY request_id, denomination`);
            // 一个申请只有 picked 组合有非 0 预占/交付，SUM 跨组合不会重复计数
            const lineByReq = new Map();
            for (const l of lineRows) {
                const list = lineByReq.get(l.request_id) ?? [];
                list.push(l);
                lineByReq.set(l.request_id, list);
            }
            const auditMap = new Map(audit.map((a) => [Number(a.denomination), Number(a.delta)]));
            const checks = [];
            // 预占（按面额）：当前被 reserved 申请占用的张数
            const heldRows = await em.query(`SELECT denomination, SUM(reserved_count - delivered_count)::int AS held
         FROM cash_line l JOIN cash_request r ON r.id = l.request_id
         WHERE r.reserve_status = 'reserved'
         GROUP BY denomination`);
            const heldMap = new Map(heldRows.map((h) => [Number(h.denomination), Number(h.held)]));
            // 1) 每面额库存守恒：初始 = 现存 + 预占 + 已出
            for (const c of cassettes) {
                const d = Number(c.denomination);
                const held = heldMap.get(d) ?? 0;
                const ok = Number(c.initial_count) ===
                    Number(c.remaining_count) + held + Number(c.delivered_count);
                checks.push({
                    name: `守恒 ${d}分：初始=现存+预占+已出`,
                    pass: ok,
                    detail: `${c.initial_count} = ${c.remaining_count} + ${held} + ${c.delivered_count}`,
                });
            }
            // 2) 审计流水：现存 = Σ所有变动（reset 配钞 + 预占 - 回补）
            for (const c of cassettes) {
                const d = Number(c.denomination);
                const delta = auditMap.get(d) ?? 0;
                const ok = Number(c.remaining_count) === delta;
                checks.push({
                    name: `审计 ${d}分：现存=流水净额（含初始配钞）`,
                    pass: ok,
                    detail: `${c.remaining_count} = ${delta}`,
                });
            }
            // 3) 预占占用 = 初始-现存-已出（按金额），与 reserved 申请对账
            let heldByCassette = 0;
            let heldByRequests = 0;
            let deliveredValueByCassette = 0;
            let initialValue = 0;
            for (const c of cassettes) {
                const d = Number(c.denomination);
                initialValue += d * Number(c.initial_count);
                heldByCassette +=
                    d * (Number(c.initial_count) - Number(c.remaining_count) - Number(c.delivered_count));
                deliveredValueByCassette += d * Number(c.delivered_count);
            }
            for (const r of requests) {
                if (r.reserve_status === 'reserved') {
                    heldByRequests += Number(r.reserved_cents) - Number(r.delivered_cents);
                }
            }
            checks.push({
                name: '预占占用金额对账（钞箱口径 = 申请口径）',
                pass: heldByCassette === heldByRequests,
                detail: `钞箱被预占未出 ${heldByCassette} 分；reserved 申请合计 ${heldByRequests} 分`,
            });
            // 4) 已交付金额：钞箱口径 = 申请口径
            const deliveredValueByRequests = requests.reduce((s, r) => s + Number(r.delivered_cents), 0);
            checks.push({
                name: '已交付金额对账（钞箱口径 = 申请口径）',
                pass: deliveredValueByCassette === deliveredValueByRequests,
                detail: `钞箱已出 ${deliveredValueByCassette} 分；申请回报合计 ${deliveredValueByRequests} 分`,
            });
            // 5) 全局价值守恒：初始 = 现存 + 预占 + 已出
            let remainingValue = 0;
            for (const c of cassettes) {
                remainingValue += Number(c.denomination) * Number(c.remaining_count);
            }
            checks.push({
                name: '全局价值守恒：初始价值 = 现存 + 预占 + 已出',
                pass: initialValue === remainingValue + heldByRequests + deliveredValueByRequests,
                detail: `${initialValue} = ${remainingValue} + ${heldByRequests} + ${deliveredValueByRequests}`,
            });
            // 6) 逐申请：行明细之和 = 头表金额；交付 ≤ 预占 ≤ 计划金额
            let linePass = true;
            for (const r of requests) {
                const lines = lineByReq.get(r.id) ?? [];
                const reservedVal = lines.reduce((s, l) => s + Number(l.denomination) * Number(l.reserved), 0);
                const deliveredVal = lines.reduce((s, l) => s + Number(l.denomination) * Number(l.delivered), 0);
                const ok1 = reservedVal === Number(r.reserved_cents);
                const ok2 = deliveredVal === Number(r.delivered_cents);
                const ok3 = deliveredVal <= reservedVal;
                if (!(ok1 && ok2 && ok3))
                    linePass = false;
                checks.push({
                    name: `明细核对 ${r.client_ref}`,
                    pass: ok1 && ok2 && ok3,
                    detail: `计划 ${r.amount}；预占 ${reservedVal}；实出 ${deliveredVal}（头表 ${r.delivered_cents}）`,
                });
            }
            const perRequest = requests.map((r) => ({
                id: r.id,
                clientRef: r.client_ref,
                amount: Number(r.amount),
                status: r.reserve_status,
                reservedCents: Number(r.reserved_cents),
                deliveredCents: Number(r.delivered_cents),
                outstandingCents: r.reserve_status === 'reserved'
                    ? Number(r.reserved_cents) - Number(r.delivered_cents)
                    : 0,
            }));
            const allPass = checks.every((c) => c.pass);
            return {
                allPass,
                summary: {
                    initialValueCents: initialValue,
                    remainingValueCents: remainingValue,
                    heldValueCents: heldByRequests,
                    deliveredValueCents: deliveredValueByRequests,
                    requestCount: requests.length,
                },
                cassettes: cassettes.map((c) => ({
                    denomination: Number(c.denomination),
                    initialCount: Number(c.initial_count),
                    remainingCount: Number(c.remaining_count),
                    deliveredCount: Number(c.delivered_count),
                })),
                requests: perRequest,
                checks,
            };
        });
    }
};
exports.CashService = CashService;
exports.CashService = CashService = CashService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource,
        planner_service_1.PlannerService])
], CashService);
//# sourceMappingURL=cash.service.js.map