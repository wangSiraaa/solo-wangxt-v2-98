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
exports.CashRequest = void 0;
const typeorm_1 = require("typeorm");
const cash_line_entity_1 = require("./cash-line.entity");
/** 一笔模拟取款申请 */
let CashRequest = class CashRequest {
    id;
    /** 调用方提供的业务编号（同一批内唯一），便于人读对账 */
    clientRef;
    /** 取款金额，整数分 */
    amount;
    /** 允许面额，整数分数组 */
    allowedDenominations;
    /** 单笔张数上限 */
    maxNotes;
    planStatus;
    /** 不可行时的人话解释 */
    reason;
    /** 枚举到的可行组合数量（上限 5） */
    optionCount;
    /** 无预占；reserved=已预占未出钞；dispensed=足额出钞；partial=部分出钞；failed=拒钞/未完成且已回补 */
    reserveStatus;
    /** 已实际出钞金额，整数分。注意：计划/预占成功都不改变它。 */
    deliveredCents;
    /** 已实际出钞总张数 */
    deliveredNotes;
    /** 预占金额（预占成功后写入，出钞后保留用于对账） */
    reservedCents;
    createdAt;
    lines;
};
exports.CashRequest = CashRequest;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CashRequest.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 64, name: 'client_ref' }),
    __metadata("design:type", String)
], CashRequest.prototype, "clientRef", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', array: true, name: 'allowed_denominations' }),
    __metadata("design:type", Array)
], CashRequest.prototype, "allowedDenominations", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'max_notes' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "maxNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'feasible' }),
    __metadata("design:type", String)
], CashRequest.prototype, "planStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CashRequest.prototype, "reason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'option_count' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "optionCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'none' }),
    __metadata("design:type", String)
], CashRequest.prototype, "reserveStatus", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'delivered_cents' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "deliveredCents", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'delivered_notes' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "deliveredNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'reserved_cents' }),
    __metadata("design:type", Number)
], CashRequest.prototype, "reservedCents", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', default: () => 'now()' }),
    __metadata("design:type", Date)
], CashRequest.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => cash_line_entity_1.CashLine, (line) => line.request, { cascade: true }),
    __metadata("design:type", Array)
], CashRequest.prototype, "lines", void 0);
exports.CashRequest = CashRequest = __decorate([
    (0, typeorm_1.Entity)('cash_request')
], CashRequest);
//# sourceMappingURL=cash-request.entity.js.map