import { Injectable } from '@nestjs/common';

/** 金额一律使用整数分；张数一律非负整数。全程禁止浮点参与计算。 */

export interface DenomStock {
  denomination: number; // 分
  available: number;
}

export interface PlanLine {
  denomination: number; // 分
  count: number;
}

export interface PlanSolution {
  optionIndex: number;
  totalNotes: number;
  totalCents: number;
  lines: PlanLine[];
}

export type InfeasibleCode =
  | 'EMPTY_DENOMINATION'
  | 'DENOMINATION_GAP'
  | 'DENOMINATION_SET'
  | 'NOTE_LIMIT'
  | 'INSUFFICIENT_STOCK';

export interface InfeasibleReason {
  code: InfeasibleCode;
  message: string;
  /** 库存受限：当前最多能凑到的金额（分） */
  maxReachableCents?: number;
  /** 库存受限：距离目标还缺多少（分） */
  shortMissingCents?: number;
  /** 已被用尽的“卡脖子”面额 */
  binding?: { denomination: number; have: number }[];
  /** 面额粒度问题：无法整除的余数（分） */
  gcdGap?: number;
}

export interface PlanResult {
  feasible: boolean;
  amount: number;
  maxNotes: number;
  solutions: PlanSolution[];
  reason?: InfeasibleReason;
}

const SENT = 0xffffffff;

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * 有界找零 DP 的一步：在 prev（只用后缀面额的解）上加入面额 d、可用 avail 张。
 * 对每个模 d 的剩余类用单调队列，O(target) 完成：
 *   next[i] = i + extremum { prev[j] - j | j ∈ [i-avail, i] }
 * min/max 分别得到“最少/最多需要多少张”，SENT 表示不可达。
 */
function boundedStep(
  prev: Uint32Array,
  d: number,
  avail: number,
  target: number,
  mode: 'min' | 'max',
): Uint32Array {
  const next = new Uint32Array(target + 1).fill(SENT);
  const seqCap = Math.floor(target / d) + 2;
  const dq = new Int32Array(seqCap);
  const keys = new Int32Array(seqCap);
  const lastResidue = Math.min(d - 1, target);
  for (let r = 0; r <= lastResidue; r++) {
    let head = 0;
    let tail = 0;
    let i = 0;
    for (let s = r; s <= target; s += d, i++) {
      const v = prev[s];
      if (v !== SENT) {
        const key = v - i;
        while (
          head < tail &&
          (mode === 'min' ? keys[tail - 1] >= key : keys[tail - 1] <= key)
        ) {
          tail--;
        }
        keys[tail] = key;
        dq[tail] = i;
        tail++;
      }
      while (head < tail && dq[head] < i - avail) {
        head++;
      }
      if (head < tail) {
        const j = dq[head];
        next[s] = i + prev[r + j * d] - j;
      }
    }
  }
  return next;
}

interface BoundTables {
  denoms: number[];
  stock: number[];
  minT: Uint32Array[];
  maxT: Uint32Array[];
  /** suffixGcd[k] = 第 k..n-1 个面额的 gcd */
  suffixGcd: number[];
}

function buildTables(
  sortedDenoms: number[],
  stock: number[],
  target: number,
): BoundTables {
  const n = sortedDenoms.length;
  const baseMin = new Uint32Array(target + 1).fill(SENT);
  const baseMax = new Uint32Array(target + 1).fill(SENT);
  baseMin[0] = 0;
  baseMax[0] = 0;
  const minT: Uint32Array[] = new Array(n + 1);
  const maxT: Uint32Array[] = new Array(n + 1);
  const suffixGcd = new Array<number>(n + 1).fill(0);
  minT[n] = baseMin;
  maxT[n] = baseMax;
  for (let k = n - 1; k >= 0; k--) {
    suffixGcd[k] =
      k === n - 1 ? sortedDenoms[k] : gcd(sortedDenoms[k], suffixGcd[k + 1]);
    minT[k] = boundedStep(minT[k + 1], sortedDenoms[k], stock[k], target, 'min');
    maxT[k] = boundedStep(maxT[k + 1], sortedDenoms[k], stock[k], target, 'max');
  }
  return { denoms: sortedDenoms, stock, minT, maxT, suffixGcd };
}

/** 无限张数前提下的最少纸币数（仅用于区分“面额不行”还是“库存不行”） */
function unboundedMinNotes(target: number, denoms: number[]): number {
  const dp = new Uint32Array(target + 1).fill(SENT);
  dp[0] = 0;
  for (let s = 1; s <= target; s++) {
    let best = SENT;
    for (const d of denoms) {
      if (d <= s && dp[s - d] !== SENT && dp[s - d] + 1 < best) {
        best = dp[s - d] + 1;
      }
    }
    dp[s] = best;
  }
  return dp[target] === SENT ? -1 : dp[target];
}

@Injectable()
export class PlannerService {
  /**
   * 为单笔取款选择组合。
   * @param maxSolutions 最多枚举多少个不同组合（按总张数升序，0 号为推荐：张数最少）
   */
  plan(
    amount: number,
    stocksInput: DenomStock[],
    maxNotes: number,
    maxSolutions = 5,
  ): PlanResult {
    const stocks = [...stocksInput]
      .filter((s) => s.available > 0)
      .sort((a, b) => b.denomination - a.denomination);
    const denoms = stocks.map((s) => s.denomination);
    const stock = stocks.map((s) => s.available);

    const fail = (reason: InfeasibleReason): PlanResult => ({
      feasible: false,
      amount,
      maxNotes,
      solutions: [],
      reason,
    });

    if (denoms.length === 0) {
      return fail({
        code: 'EMPTY_DENOMINATION',
        message: '没有任何有库存的允许面额，无法配钞。',
      });
    }

    const g = denoms.reduce((acc, d) => gcd(acc, d));
    if (amount % g !== 0) {
      const gap = amount % g;
      const below = amount - gap;
      return fail({
        code: 'DENOMINATION_GAP',
        gcdGap: gap,
        message: `允许面额都是 ${g} 分的倍数，${amount} 分无法凑出；低于该金额最近可凑 ${below} 分，还差 ${gap} 分。`,
      });
    }

    const t = buildTables(denoms, stock, amount);
    const minBounded = t.minT[0][amount];
    const maxBounded = t.maxT[0][amount];

    if (minBounded === SENT) {
      // 库存受限或面额集合受限：用无限背包区分
      const minUnbounded = unboundedMinNotes(amount, denoms);
      if (minUnbounded < 0) {
        const smallest = denoms[denoms.length - 1];
        return fail({
          code: 'DENOMINATION_SET',
          message: `即使面额库存无限，所选面额也凑不出 ${amount} 分（最小面额 ${smallest} 分，金额不能由这些面额组合构成）。`,
        });
      }
      if (minUnbounded > maxNotes) {
        return fail({
          code: 'NOTE_LIMIT',
          message: `该金额至少需要 ${minUnbounded} 张，但单笔张数上限为 ${maxNotes} 张。`,
        });
      }
      // 纯库存问题：找 ≤ amount 的最大可达金额并重建其组合，指出用尽的面额
      let maxReach = 0;
      for (let s = amount - 1; s >= 1; s--) {
        if (t.minT[0][s] !== SENT && t.minT[0][s] <= maxNotes) {
          maxReach = s;
          break;
        }
      }
      const combo = this.solveOne(t, maxReach, maxNotes);
      const binding =
        combo?.lines
          .filter((l) => l.count === stock[denoms.indexOf(l.denomination)])
          .map((l) => ({
            denomination: l.denomination,
            have: stock[denoms.indexOf(l.denomination)],
          })) ?? [];
      const missing = amount - maxReach;
      const smallest = denoms[denoms.length - 1];
      let message = `库存不足：当前最多可凑 ${maxReach} 分，尚缺 ${missing} 分（目标 ${amount} 分）。`;
      if (binding.length > 0) {
        message +=
          ' 已被用尽的面额：' +
          binding.map((b) => `${b.denomination} 分（库存 ${b.have} 张全占用）`).join('、') +
          '。';
      }
      if (missing > 0 && missing < smallest) {
        message += ` 最小面额 ${smallest} 分也大于缺口 ${missing} 分，无法用现有面额补齐。`;
      }
      return fail({
        code: 'INSUFFICIENT_STOCK',
        message,
        maxReachableCents: maxReach,
        shortMissingCents: missing,
        binding,
      });
    }

    if (minBounded > maxNotes || maxBounded === SENT) {
      return fail({
        code: 'NOTE_LIMIT',
        message: `可行组合最少需要 ${minBounded} 张，但单笔张数上限为 ${maxNotes} 张。`,
      });
    }

    // 可行：按“恰好 t 张”分层枚举，保证组合按总张数升序产出
    const solutions: PlanSolution[] = [];
    const picks = new Array<number>(denoms.length).fill(0);
    const dfs = (k: number, remain: number, exact: number): void => {
      if (solutions.length >= maxSolutions) return;
      if (remain === 0) {
        if (exact === 0) {
          const lines: PlanLine[] = [];
          let total = 0;
          let notes = 0;
          for (let i = 0; i < denoms.length; i++) {
            if (picks[i] > 0) {
              lines.push({ denomination: denoms[i], count: picks[i] });
              total += denoms[i] * picks[i];
              notes += picks[i];
            }
          }
          solutions.push({
            optionIndex: solutions.length,
            totalNotes: notes,
            totalCents: total,
            lines,
          });
        }
        return;
      }
      if (k === denoms.length) return;
      const d = denoms[k];
      const cMax = Math.min(stock[k], Math.floor(remain / d), exact);
      for (let c = cMax; c >= 0; c--) {
        const rem2 = remain - c * d;
        const budget = exact - c;
        // 后缀必须恰好用 budget 张凑出 rem2。
        // 后缀面额为 g_k 的倍数，纸币数每 +1 可替换的价值步长为 g_{k+1}/d_k，
        // 因此可行纸币数构成公差 step 的等差数列（min..max 内、同余）。
        const mn = t.minT[k + 1][rem2];
        const mx = t.maxT[k + 1][rem2];
        // 后缀可行纸币数构成等差数列：用面额 g 替换一张 d 面额，张数步长 = g/d
        // g = gcd(d_k, suffixGcd[k+1])（最后一层后缀为空时步长 1）
        const gNext = k + 1 < denoms.length ? gcd(d, t.suffixGcd[k + 1]) : d;
        const step = Math.max(1, gNext / d);
        const exactOk =
          mn !== SENT &&
          mx !== SENT &&
          mn <= budget &&
          budget <= mx &&
          (budget - mn) % step === 0;
        if (exactOk) {
          picks[k] = c;
          dfs(k + 1, rem2, budget);
          picks[k] = 0;
          if (solutions.length >= maxSolutions) return;
        }
      }
    };
    for (let notes = minBounded; notes <= Math.min(maxBounded, maxNotes); notes++) {
      dfs(0, amount, notes);
      if (solutions.length >= maxSolutions) break;
    }

    return { feasible: true, amount, maxNotes, solutions };
  }

  /** 不要求张数恰好，返回任意一个可行组合（大面额优先，用于不可行原因重建） */
  private solveOne(t: BoundTables, target: number, budget: number): PlanSolution | null {
    if (target === 0) {
      return { optionIndex: 0, totalNotes: 0, totalCents: 0, lines: [] };
    }
    const picks = new Array<number>(t.denoms.length).fill(0);
    const dfs = (k: number, remain: number, budgetLeft: number): boolean => {
      if (remain === 0) return true;
      if (k === t.denoms.length) return false;
      const d = t.denoms[k];
      const cMax = Math.min(t.stock[k], Math.floor(remain / d), budgetLeft);
      for (let c = cMax; c >= 0; c--) {
        const rem2 = remain - c * d;
        const mn = t.minT[k + 1][rem2];
        if (mn !== SENT && mn <= budgetLeft - c) {
          picks[k] = c;
          if (dfs(k + 1, rem2, budgetLeft - c)) return true;
          picks[k] = 0;
        }
      }
      return false;
    };
    if (!dfs(0, target, budget)) return null;
    const lines: PlanLine[] = [];
    let total = 0;
    let notes = 0;
    for (let i = 0; i < t.denoms.length; i++) {
      if (picks[i] > 0) {
        lines.push({ denomination: t.denoms[i], count: picks[i] });
        total += t.denoms[i] * picks[i];
        notes += picks[i];
      }
    }
    return { optionIndex: 0, totalNotes: notes, totalCents: total, lines };
  }
}
