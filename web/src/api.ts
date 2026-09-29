/** API 类型与调用。金额一律整数分，前端只在展示层除以 100。 */

export interface Cassette {
  denomination: number;
  initialCount: number;
  remainingCount: number;
  deliveredCount: number;
  remainingValueCents: number;
}

export interface PlanLineView {
  denomination: number;
  plannedCount: number;
  reservedCount: number;
  deliveredCount: number;
  picked: boolean;
}

export interface PlanOption {
  optionIndex: number;
  lines: PlanLineView[];
  totalNotes: number;
  totalCents: number;
}

export type PlanStatus = 'feasible' | 'infeasible';
export type ReserveStatus = 'none' | 'reserved' | 'dispensed' | 'partial' | 'failed';

export interface CashRequestView {
  id: string;
  clientRef: string;
  amountCents: number;
  allowedDenominations: number[];
  maxNotes: number;
  planStatus: PlanStatus;
  reason: string | null;
  optionCount: number;
  reserveStatus: ReserveStatus;
  reservedCents: number;
  deliveredCents: number;
  deliveredNotes: number;
  options: PlanOption[];
}

export interface ReconcileCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ReconcileReport {
  allPass: boolean;
  summary: {
    initialValueCents: number;
    remainingValueCents: number;
    heldValueCents: number;
    deliveredValueCents: number;
    requestCount: number;
  };
  cassettes: {
    denomination: number;
    initialCount: number;
    remainingCount: number;
    deliveredCount: number;
  }[];
  requests: {
    id: string;
    clientRef: string;
    amount: number;
    status: ReserveStatus;
    reservedCents: number;
    deliveredCents: number;
    outstandingCents: number;
  }[];
  checks: ReconcileCheck[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.message ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  cassettes: () => call<Cassette[]>('/cassettes'),
  requests: () => call<CashRequestView[]>('/requests'),
  reconcile: () => call<ReconcileReport>('/reconcile'),
  reset: (cassettes?: { denomination: number; count: number }[]) =>
    call<{ ok: boolean; cassettes: Cassette[] }>('/cassettes/reset', {
      method: 'POST',
      body: JSON.stringify({ cassettes }),
    }),
  planBatch: (
    requests: {
      clientRef: string;
      amountCents: number;
      allowedDenominations: number[];
      maxNotes: number;
    }[],
    maxSolutions = 5,
  ) =>
    call<{ requests: CashRequestView[] }>('/plans/batch', {
      method: 'POST',
      body: JSON.stringify({ requests, maxSolutions }),
    }),
  reserveBatch: (
    ids: string[],
    opts: { allOrNothing: boolean; optionByRequest?: Record<string, number> },
  ) =>
    call<{
      reserved: string[];
      failed: { id: string; clientRef: string; reason: string }[];
    }>('/reserve/batch', {
      method: 'POST',
      body: JSON.stringify({ ids, ...opts }),
    }),
  dispense: (
    id: string,
    outcome: 'success' | 'reject' | 'partial',
    delivered?: Record<string, number>,
  ) =>
    call<{ request: CashRequestView }>(`/requests/${id}/dispense`, {
      method: 'POST',
      body: JSON.stringify({ outcome, delivered }),
    }),
};

/** 分 -> 元展示（只在渲染层做除法） */
export function yuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 用户输入的“元”金额 -> 整数分；拒绝超过 2 位小数，避免浮点误差 */
export function yuanToCents(input: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) {
    throw new Error('金额必须是最多两位小数的非负数');
  }
  const [intPart, fracPart = ''] = input.trim().split('.');
  return Number(intPart) * 100 + Number((fracPart + '00').slice(0, 2));
}
