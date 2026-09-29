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
exports.CashLine = void 0;
const typeorm_1 = require("typeorm");
const cash_request_entity_1 = require("./cash-request.entity");
/**
 * 一张申请的某个组合的一行（面额 x 张数）。
 * picked=true 表示该组合被选中并用于预占/出钞。
 */
let CashLine = class CashLine {
    id;
    requestId;
    request;
    /** 组合序号，0 起（0 为推荐组合：张数最少） */
    optionIndex;
    denomination;
    /** 计划使用张数 */
    plannedCount;
    /** 预占张数（仅 picked 组合且预占成功后非 0） */
    reservedCount;
    /** 实际出钞张数（拒钞可 < 预占张数） */
    deliveredCount;
    /** 该组合是否被选中 */
    picked;
};
exports.CashLine = CashLine;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CashLine.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', name: 'request_id' }),
    __metadata("design:type", String)
], CashLine.prototype, "requestId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => cash_request_entity_1.CashRequest, (req) => req.lines, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'request_id' }),
    __metadata("design:type", cash_request_entity_1.CashRequest)
], CashLine.prototype, "request", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', name: 'option_index' }),
    __metadata("design:type", Number)
], CashLine.prototype, "optionIndex", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CashLine.prototype, "denomination", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CashLine.prototype, "plannedCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'reserved_count' }),
    __metadata("design:type", Number)
], CashLine.prototype, "reservedCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0, name: 'delivered_count' }),
    __metadata("design:type", Number)
], CashLine.prototype, "deliveredCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], CashLine.prototype, "picked", void 0);
exports.CashLine = CashLine = __decorate([
    (0, typeorm_1.Entity)('cash_line')
], CashLine);
//# sourceMappingURL=cash-line.entity.js.map