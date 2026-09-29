export interface Cassette {
  id: number;
  denomination: number;
  stockTotal: number;
  stockReserved: number;
  stockDelivered: number;
  stockRejected: number;
  stockAvailable: number;
}

export interface Combination {
  counts: Record<string, number>;
  notes: number;
  total: number;
}

export interface InfeasibleExplanation {
  feasible: false;
  reasonCode: string;
  message: string;
  amount: number;
  maxReachableBelow?: number;
  shortage?: number;
  greedyRemainder?: number;
  minNotesWithoutLimit?: number;
  maxNotes?: number;
  totalStockValue?: number;
  gcd?: number;
}

export interface FeasibleResult {
  feasible: true;
  amount: number;
  maxNotes: number;
  primary: Combination;
  alternative: Combination | null;
  combinationCountAtLeast: number;
  hasMultiple: boolean;
}

export type SolveResult = FeasibleResult | InfeasibleExplanation;

export interface WithdrawRequest {
  amount: number;
  allowedDenominations?: number[];
  maxNotes: number;
}

export interface PlanItem {
  seq: number;
  request: WithdrawRequest;
  result: SolveResult;
}

export interface PlanBatch {
  total: number;
  feasibleCount: number;
  items: PlanItem[];
}

export type ReservationStatus =
  | 'RESERVED'
  | 'DISPENSED'
  | 'PARTIAL'
  | 'FAILED';

export interface ReservationView {
  id: string;
  seq: number;
  requestedAmount: number;
  planCounts: Record<string, number>;
  planNotes: number;
  status: ReservationStatus;
}

export interface ReserveOutcome {
  batchId: string;
  status: 'RESERVED' | 'ROLLED_BACK';
  reservedCount: number;
  error?: string;
  failedAtSeq?: number;
  reservations?: ReservationView[];
}

export interface DispenseResult {
  reservationId: string;
  seq: number;
  requestedAmount: number;
  status: ReservationStatus;
  planCounts: Record<string, number>;
  deliveredCounts: Record<string, number>;
  rejectedCounts: Record<string, number>;
  unfinishedCounts: Record<string, number>;
  deliveredAmount: number;
  rejectedAmount: number;
  unfinishedAmount: number;
  note: string | null;
}

export interface DispenseResponse {
  batchId: string;
  mode: string;
  results: DispenseResult[];
}

export interface Reconciliation {
  cassettes: Array<{
    denomination: number;
    stockTotal: number;
    stockReserved: number;
    stockDelivered: number;
    stockRejected: number;
    stockAvailable: number;
  }>;
  totals: {
    stockTotalValue: number;
    reservedValue: number;
    deliveredValue: number;
    rejectedValue: number;
    availableValue: number;
    stockTotalNotes: number;
    reservedNotes: number;
    deliveredNotes: number;
    rejectedNotes: number;
    availableNotes: number;
  };
  reservations: Array<{
    id: string;
    batchId: string;
    seq: number;
    requestedAmount: number;
    status: ReservationStatus;
    planAmount: number;
    deliveredAmount: number;
    rejectedAmount: number;
    unfinishedAmount: number;
    note: string | null;
  }>;
  invariantCheck: { ok: boolean; violations: string[] };
}
