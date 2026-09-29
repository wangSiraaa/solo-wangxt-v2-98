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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashController = void 0;
exports.serializeRequests = serializeRequests;
const common_1 = require("@nestjs/common");
const cash_service_1 = require("./cash.service");
const dto_1 = require("./dto");
function mapError(e) {
    if (e instanceof dto_1.BadInput)
        throw new common_1.BadRequestException(e.message);
    if (e instanceof Error && e.name === 'ConflictError') {
        const ce = e;
        throw new common_1.ConflictException({ message: ce.message, details: ce.details });
    }
    throw e;
}
let CashController = class CashController {
    cash;
    constructor(cash) {
        this.cash = cash;
    }
    cassettes() {
        return this.cash.listCassettes();
    }
    requests() {
        return this.cash.listRequests();
    }
    reconcile() {
        return this.cash.reconcile();
    }
    async reset(body) {
        try {
            await this.cash.reset(body?.cassettes ?? cash_service_1.DEFAULT_CASSETTES);
            return { ok: true, cassettes: await this.cash.listCassettes() };
        }
        catch (e) {
            mapError(e);
        }
    }
    /** 第一步：一批申请生成计划（不碰库存） */
    async planBatch(body) {
        try {
            const requests = await this.cash.planBatch(body ?? { requests: [] });
            return { requests: serializeRequests(requests) };
        }
        catch (e) {
            mapError(e);
        }
    }
    /** 第二步：事务预占。body: { ids, allOrNothing, optionByRequest } */
    async reserveBatch(body) {
        try {
            const result = await this.cash.reserveBatch(body?.ids ?? [], {
                allOrNothing: body?.allOrNothing,
                optionByRequest: body?.optionByRequest,
            });
            return result;
        }
        catch (e) {
            mapError(e);
        }
    }
    /** 第三步：模拟器出钞回报 */
    async dispense(id, body) {
        try {
            const req = await this.cash.dispense(id, body?.outcome, body?.delivered);
            return { request: serializeRequests([req])[0] };
        }
        catch (e) {
            mapError(e);
        }
    }
};
exports.CashController = CashController;
__decorate([
    (0, common_1.Get)('cassettes'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CashController.prototype, "cassettes", null);
__decorate([
    (0, common_1.Get)('requests'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CashController.prototype, "requests", null);
__decorate([
    (0, common_1.Get)('reconcile'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CashController.prototype, "reconcile", null);
__decorate([
    (0, common_1.Post)('cassettes/reset'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "reset", null);
__decorate([
    (0, common_1.Post)('plans/batch'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "planBatch", null);
__decorate([
    (0, common_1.Post)('reserve/batch'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "reserveBatch", null);
__decorate([
    (0, common_1.Post)('requests/:id/dispense'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "dispense", null);
exports.CashController = CashController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [cash_service_1.CashService])
], CashController);
/** 序列化为前端友好结构：snake_case 实体 → camelCase + 组合分组 */
function serializeRequests(requests) {
    return requests.map((r) => {
        const options = [];
        for (const line of r.lines ?? []) {
            let opt = options[line.optionIndex];
            if (!opt) {
                opt = { optionIndex: line.optionIndex, lines: [], totalNotes: 0, totalCents: 0 };
                options[line.optionIndex] = opt;
            }
            opt.lines.push({
                denomination: line.denomination,
                plannedCount: line.plannedCount,
                reservedCount: line.reservedCount,
                deliveredCount: line.deliveredCount,
                picked: line.picked,
            });
            // 计划阶段即展示组合自身的张数/金额（来自计划行，与是否选中无关）
            opt.totalNotes += line.plannedCount;
            opt.totalCents += line.denomination * line.plannedCount;
        }
        return {
            id: r.id,
            clientRef: r.clientRef,
            amountCents: r.amount,
            allowedDenominations: r.allowedDenominations,
            maxNotes: r.maxNotes,
            planStatus: r.planStatus,
            reason: r.reason,
            optionCount: r.optionCount,
            reserveStatus: r.reserveStatus,
            reservedCents: r.reservedCents,
            deliveredCents: r.deliveredCents,
            deliveredNotes: r.deliveredNotes,
            options: options.filter(Boolean),
        };
    });
}
//# sourceMappingURL=cash.controller.js.map