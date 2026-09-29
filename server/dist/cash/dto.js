"use strict";
/** 入参校验：全部金额/张数必须是安全范围内的非负整数，拒绝浮点。 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BadInput = void 0;
exports.assertPosInt = assertPosInt;
exports.assertNonNegInt = assertNonNegInt;
exports.assertDenomList = assertDenomList;
exports.normalizePlanRequest = normalizePlanRequest;
class BadInput extends Error {
    constructor(message) {
        super(message);
        this.name = 'BadInput';
    }
}
exports.BadInput = BadInput;
function assertPosInt(value, field, max = 1_000_000_00) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new BadInput(`${field} 必须是整数（金额单位：分），收到：${String(value)}`);
    }
    if (value <= 0 || value > max) {
        throw new BadInput(`${field} 必须是 1..${max} 的正整数，收到：${value}`);
    }
    return value;
}
function assertNonNegInt(value, field, max = 1_000_000) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new BadInput(`${field} 必须是非负整数，收到：${String(value)}`);
    }
    if (value < 0 || value > max) {
        throw new BadInput(`${field} 必须是 0..${max} 的整数，收到：${value}`);
    }
    return value;
}
function assertDenomList(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new BadInput('allowedDenominations 必须是非空整数数组（单位：分）');
    }
    const seen = new Set();
    for (const d of value) {
        assertPosInt(d, '面额');
        if (d > 1_000_000)
            throw new BadInput(`面额 ${d} 超出允许范围`);
        seen.add(d);
    }
    return [...seen];
}
function normalizePlanRequest(raw, idx) {
    const clientRef = typeof raw?.clientRef === 'string' && raw.clientRef.trim().length > 0
        ? raw.clientRef.trim()
        : `req-${idx + 1}`;
    return {
        clientRef: clientRef.slice(0, 64),
        amountCents: assertPosInt(raw?.amountCents, `[${clientRef}] amountCents`),
        allowedDenominations: assertDenomList(raw?.allowedDenominations),
        maxNotes: assertPosInt(raw?.maxNotes, `[${clientRef}] maxNotes`, 10000),
    };
}
//# sourceMappingURL=dto.js.map