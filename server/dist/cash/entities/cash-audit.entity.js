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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CashAudit = void 0;
const typeorm_1 = require("typeorm");
/** 库存变动审计：任何 remainingCount 的增减都必须留痕，供守恒核对 */
let CashAudit = class CashAudit {
    id;
    denomination;
    /** 张数变化：预占为负，回补为正 */
    deltaCount;
    /** reserve | dispense-hold | dispense-reject | dispense-partial-refund | reset */
    kind;
    requestId;
    note;
    createdAt;
};
exports.CashAudit = CashAudit;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CashAudit.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CashAudit.prototype, "denomination", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'delta_count' }),
    __metadata("design:type", Number)
], CashAudit.prototype, "deltaCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], CashAudit.prototype, "kind", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true, name: 'request_id' }),
    __metadata("design:type", Object)
], CashAudit.prototype, "requestId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CashAudit.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', default: () => 'now()' }),
    __metadata("design:type", Date)
], CashAudit.prototype, "createdAt", void 0);
exports.CashAudit = CashAudit = __decorate([
    (0, typeorm_1.Entity)('cash_audit')
], CashAudit);
//# sourceMappingURL=cash-audit.entity.js.map