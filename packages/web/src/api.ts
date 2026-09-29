import type {
  Cassette,
  DispenseResponse,
  PlanBatch,
  Reconciliation,
  ReserveOutcome,
  SolveResult,
  WithdrawRequest,
} from './types';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  cassettes: () => jsonFetch<Cassette[]>('/api/cassettes'),
  evaluate: (req: WithdrawRequest) =>
    jsonFetch<SolveResult>('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  plan: (requests: WithdrawRequest[]) =>
    jsonFetch<PlanBatch>('/api/plan', {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }),
  reserve: (requests: WithdrawRequest[]) =>
    jsonFetch<ReserveOutcome>('/api/reserve', {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }),
  dispense: (
    batchId: string,
    body: {
      mode?: 'simulate' | 'success' | 'reject' | 'shortage';
      rejectRate?: number;
      shortageRatio?: number;
      seed?: number;
    },
  ) =>
    jsonFetch<DispenseResponse>(`/api/batches/${batchId}/dispense`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reconciliation: () =>
    jsonFetch<Reconciliation>('/api/reconciliation'),
  reset: (cassettes?: Array<{ denomination: number; stockTotal: number }>) =>
    jsonFetch<void>('/api/admin/reset', {
      method: 'POST',
      body: JSON.stringify({ cassettes }),
    }),
};
