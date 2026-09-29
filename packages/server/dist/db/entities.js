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
exports.BatchEntity = exports.ReservationEntity = exports.CassetteEntity = void 0;
const typeorm_1 = require("typeorm");
/**
 * 钞箱：一种面额一行。
 * stock_total       钞箱当前总张数（含可用、预占、已出钞、拒钞后不在可用口径内单独追踪）
 * stock_reserved    已被预占但尚未出钞结算的张数
 * stock_delivered   已确认出钞交付给客户的张数（累计，仅用于展示/核对，可在补钞时重置）
 * stock_rejected    模拟器判定拒钞、进入回收/拒钞箱的张数（累计）
 *
 * 口径不变式（每个面额）：
 *   available = stock_total - stock_reserved - stock_delivered - stock_rejected >= 0
 * 预占只增加 stock_reserved；结算时把预占转为 delivered/rejected 或释放回可用。
 */
let CassetteEntity = class CassetteEntity {
    id;
    denomination;
    stockTotal;
    stockReserved;
    stockDelivered;
    stockRejected;
    createdAt;
    updatedAt;
};
exports.CassetteEntity = CassetteEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)({ type: 'integer' }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)({ unique: true }),
    (0, typeorm_1.Column)({ type: 'integer' }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "denomination", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'stock_total' }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "stockTotal", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'stock_reserved', default: 0 }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "stockReserved", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'stock_delivered', default: 0 }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "stockDelivered", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'stock_rejected', default: 0 }),
    __metadata("design:type", Number)
], CassetteEntity.prototype, "stockRejected", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], CassetteEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], CassetteEntity.prototype, "updatedAt", void 0);
exports.CassetteEntity = CassetteEntity = __decorate([
    (0, typeorm_1.Entity)('cassettes')
], CassetteEntity);
let ReservationEntity = class ReservationEntity {
    id;
    batchId;
    seq;
    /** 客户申请的取款金额（元，正整数） */
    requestedAmount;
    /** 该笔允许的面额（元，升序） */
    allowedDenominations;
    maxNotes;
    /**
     * 计划组合快照：{ 面额: 张数 }（配钞算法给出的主组合，也是预占的组合）。
     * 计划成功不等于现金交付——现金以 stock_delivered / 状态 DISPENSED 为准。
     */
    planCounts;
    planNotes;
    /** 实际成功出钞的组合 { 面额: 张数 } */
    deliveredCounts;
    /** 拒钞（回收箱）的组合 { 面额: 张数 } */
    rejectedCounts;
    /** 未完成（既未出钞也未拒钞，预占被释放回可用库存）的组合 { 面额: 张数 } */
    unfinishedCounts;
    deliveredAmount;
    rejectedAmount;
    unfinishedAmount;
    deliveredNotes;
    /** 单笔模拟拒钞概率（0..1），仅用于审计展示 */
    rejectRate;
    status;
    note;
    createdAt;
    updatedAt;
};
exports.ReservationEntity = ReservationEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)({ type: 'bigint' }),
    __metadata("design:type", String)
], ReservationEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'bigint', name: 'batch_id' }),
    __metadata("design:type", String)
], ReservationEntity.prototype, "batchId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer' }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "seq", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'requested_amount' }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "requestedAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'allowed_denominations', array: true }),
    __metadata("design:type", Array)
], ReservationEntity.prototype, "allowedDenominations", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'max_notes' }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "maxNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', name: 'plan_counts' }),
    __metadata("design:type", Object)
], ReservationEntity.prototype, "planCounts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'plan_notes' }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "planNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', name: 'delivered_counts', default: {} }),
    __metadata("design:type", Object)
], ReservationEntity.prototype, "deliveredCounts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', name: 'rejected_counts', default: {} }),
    __metadata("design:type", Object)
], ReservationEntity.prototype, "rejectedCounts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', name: 'unfinished_counts', default: {} }),
    __metadata("design:type", Object)
], ReservationEntity.prototype, "unfinishedCounts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'delivered_amount', default: 0 }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "deliveredAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'rejected_amount', default: 0 }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "rejectedAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'unfinished_amount', default: 0 }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "unfinishedAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'delivered_notes', default: 0 }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "deliveredNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'double precision', name: 'reject_rate', default: 0 }),
    __metadata("design:type", Number)
], ReservationEntity.prototype, "rejectRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'RESERVED' }),
    __metadata("design:type", String)
], ReservationEntity.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], ReservationEntity.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], ReservationEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], ReservationEntity.prototype, "updatedAt", void 0);
exports.ReservationEntity = ReservationEntity = __decorate([
    (0, typeorm_1.Entity)('reservations')
], ReservationEntity);
/**
 * 批次：一批取款申请共享一个 batch_id。
 * 计划生成是纯计算（不落库）；预占在单个数据库事务内整批原子完成。
 */
let BatchEntity = class BatchEntity {
    id;
    /** PLANNED -> RESERVED -> SETTLED；预占事务失败则不落批、整体回滚 */
    status;
    total;
    feasibleCount;
    reservedCount;
    createdAt;
    updatedAt;
};
exports.BatchEntity = BatchEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)({ type: 'bigint' }),
    __metadata("design:type", String)
], BatchEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 16, default: 'PLANNED' }),
    __metadata("design:type", String)
], BatchEntity.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer' }),
    __metadata("design:type", Number)
], BatchEntity.prototype, "total", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'feasible_count', default: 0 }),
    __metadata("design:type", Number)
], BatchEntity.prototype, "feasibleCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'reserved_count', default: 0 }),
    __metadata("design:type", Number)
], BatchEntity.prototype, "reservedCount", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], BatchEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], BatchEntity.prototype, "updatedAt", void 0);
exports.BatchEntity = BatchEntity = __decorate([
    (0, typeorm_1.Entity)('batches')
], BatchEntity);
