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
const common_1 = require("@nestjs/common");
const db_service_1 = require("../db/db.service");
const cash_service_1 = require("./cash.service");
let CashController = class CashController {
    cash;
    db;
    constructor(cash, db) {
        this.cash = cash;
        this.db = db;
    }
    /** 钞箱库存（含可用/预占/已出钞/拒钞口径） */
    cassettes() {
        return this.cash.getCassettes();
    }
    /** 单笔试算：返回可行组合或无解解释（不预占） */
    evaluate(body) {
        return this.cash.evaluate(body);
    }
    /** 为一批申请生成计划（纯计算，不写库） */
    plan(body) {
        return this.cash.planBatch(body?.requests);
    }
    /** 在单个事务内整批预占；任何一笔不可行则整体回滚 */
    reserve(body) {
        return this.cash.reserveBatch(body?.requests);
    }
    /** 模拟整批出钞并逐笔事务结算 */
    dispense(batchId, body) {
        return this.cash.dispense(batchId, body ?? {});
    }
    /** 查询批次（计划/预占/实际结果） */
    getBatch(batchId) {
        return this.cash.getBatch(batchId);
    }
    /** 全量核对视图 */
    reconciliation() {
        return this.cash.reconciliation();
    }
    /** 重置演示数据（清空批次/预占，钞箱回到种子状态） */
    reset(body) {
        return this.db.reset(body?.cassettes);
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
    (0, common_1.Post)('evaluate'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CashController.prototype, "evaluate", null);
__decorate([
    (0, common_1.Post)('plan'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "plan", null);
__decorate([
    (0, common_1.Post)('reserve'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CashController.prototype, "reserve", null);
__decorate([
    (0, common_1.Post)('batches/:batchId/dispense'),
    __param(0, (0, common_1.Param)('batchId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CashController.prototype, "dispense", null);
__decorate([
    (0, common_1.Get)('batches/:batchId'),
    __param(0, (0, common_1.Param)('batchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CashController.prototype, "getBatch", null);
__decorate([
    (0, common_1.Get)('reconciliation'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CashController.prototype, "reconciliation", null);
__decorate([
    (0, common_1.Post)('admin/reset'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CashController.prototype, "reset", null);
exports.CashController = CashController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [cash_service_1.CashService,
        db_service_1.DbService])
], CashController);
