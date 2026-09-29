/** 入参校验：全部金额/张数必须是安全范围内的非负整数，拒绝浮点。 */

export class BadInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadInput';
  }
}

export function assertPosInt(value: unknown, field: string, max = 1_000_000_00): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadInput(`${field} 必须是整数（金额单位：分），收到：${String(value)}`);
  }
  if (value <= 0 || value > max) {
    throw new BadInput(`${field} 必须是 1..${max} 的正整数，收到：${value}`);
  }
  return value;
}

export function assertNonNegInt(value: unknown, field: string, max = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadInput(`${field} 必须是非负整数，收到：${String(value)}`);
  }
  if (value < 0 || value > max) {
    throw new BadInput(`${field} 必须是 0..${max} 的整数，收到：${value}`);
  }
  return value;
}

export function assertDenomList(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadInput('allowedDenominations 必须是非空整数数组（单位：分）');
  }
  const seen = new Set<number>();
  for (const d of value) {
    assertPosInt(d, '面额');
    if (d > 1_000_000) throw new BadInput(`面额 ${d} 超出允许范围`);
    seen.add(d);
  }
  return [...seen];
}

export interface PlanRequestDto {
  clientRef: string;
  amountCents: number;
  allowedDenominations: number[];
  maxNotes: number;
}

export interface PlanBatchDto {
  requests: PlanRequestDto[];
  /** 最多枚举的组合数，默认 5 */
  maxSolutions?: number;
}

export function normalizePlanRequest(raw: any, idx: number): PlanRequestDto {
  const clientRef =
    typeof raw?.clientRef === 'string' && raw.clientRef.trim().length > 0
      ? raw.clientRef.trim()
      : `req-${idx + 1}`;
  return {
    clientRef: clientRef.slice(0, 64),
    amountCents: assertPosInt(raw?.amountCents, `[${clientRef}] amountCents`),
    allowedDenominations: assertDenomList(raw?.allowedDenominations),
    maxNotes: assertPosInt(raw?.maxNotes, `[${clientRef}] maxNotes`, 10000),
  };
}
