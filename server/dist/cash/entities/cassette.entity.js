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
exports.Cassette = void 0;
const typeorm_1 = require("typeorm");
/** 钞箱：一种面额一个钞箱。所有金额/数量字段均为非负整数，金额单位 = 分。 */
let Cassette = class Cassette {
    /** 面额，单位分（100/200/500/1000 = ¥1/¥2/¥5/¥10） */
    denomination;
    /** 初始入库张数（核对时使用，只在 seed/reset 时变化） */
    initialCount;
    /** 当前实际可用张数（预占时扣减，出钞失败回补） */
    remainingCount;
    /** 累计已出钞张数（只增，模拟核对用） */
    deliveredCount;
    updatedAt;
};
exports.Cassette = Cassette;
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: 'int' }),
    __metadata("design:type", Number)
], Cassette.prototype, "denomination", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Cassette.prototype, "initialCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Cassette.prototype, "remainingCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], Cassette.prototype, "deliveredCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', default: () => 'now()' }),
    __metadata("design:type", Date)
], Cassette.prototype, "updatedAt", void 0);
exports.Cassette = Cassette = __decorate([
    (0, typeorm_1.Entity)('cassette')
], Cassette);
//# sourceMappingURL=cassette.entity.js.map