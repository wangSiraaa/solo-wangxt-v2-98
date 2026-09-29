/**
 * 有界整数配钞算法（bounded integer dispensing）
 *
 * 问题：给定面额 d[1..n]（张）、每种钞箱余量 stock[i]（张）、目标金额 A（元）、
 * 单笔张数上限 L，求非负整数 x[i] 满足
 *
 *     sum(d[i] * x[i]) = A
 *     0 <= x[i] <= stock[i]
 *     sum(x[i]) <= L
 *
 * 实现要点：
 *  - 分层 DP（按面额逐层推进），层内状态层 prev/cur，形状 (A+1) x (L+1)。
 *  - 对每个面额，转移 cur[a,k] = sum_{q=0..min(stock[i], floor(a/d), k)} prev[a-qd, k-q]
 *    沿“对角线” a - k*d = 常量做定长滑动窗口求和，整体复杂度 O(n * A * L)
 *    （而不是朴素 O(n * A * L * stock)）。
 *  - 层内只存“封顶可行解数” capWays ∈ {0,1,...,CAP}。CAP 表示“至少有 CAP 个不同组合”，
 *    用于判断是否存在多个可行组合。用 saturated 计数规避 255 饱和后的加法下溢。
 *  - 组合重建：贪心取当前面额最大可行张数（优先大面额、张数少），逐面额回溯；
 *    备选组合在第一个可走“次优分支”的面额选次大可行张数，保证与主组合不同。
 *  - 无解时给出结构化解释（总库存不足 / 张数上限 / 小面额找零不足 / 最接近可达金额）。
 *
 * 所有计算均为整数，全程不使用浮点，避免金额误差。
 */

export interface SolverDenom {
  /** 面额，单位：元（整数） */
  denomination: number;
  /** 钞箱可占用余量，单位：张（非负整数） */
  stock: number;
}

export interface SolveRequest {
  /** 目标金额，单位：元（正整数） */
  amount: number;
  /** 允许使用的面额（元）。空数组/缺省视为允许全部给定面额 */
  allowedDenominations?: number[];
  /** 单笔张数上限（正整数） */
  maxNotes: number;
  /** 候选面额及其库存（可包含未被允许的面额，会被过滤） */
  denoms: SolverDenom[];
}

export interface SolveCombination {
  /** 面额 -> 张数 */
  counts: Record<number, number>;
  /** 合计张数 */
  notes: number;
  /** 合计金额（应等于 amount） */
  total: number;
}

export type InfeasibleReasonCode =
  | 'AMOUNT_INVALID'
  | 'NO_DENOMINATION'
  | 'INSUFFICIENT_TOTAL_STOCK'
  | 'GCD_NOT_DIVISIBLE'
  | 'NOTE_LIMIT'
  | 'SMALL_DENOM_SHORTAGE'
  | 'NO_COMBINATION';

export interface InfeasibleExplanation {
  feasible: false;
  reasonCode: InfeasibleReasonCode;
  /** 人类可读的中文解释 */
  message: string;
  /** 目标金额 */
  amount: number;
  /** 允许面额下，不考虑张数上限时能凑出的 <= amount 的最大金额 */
  maxReachableBelow?: number;
  /** amount - maxReachableBelow，即“凑不齐的金额” */
  shortage?: number;
  /** 贪心（优先大面额）后剩余的尾差，作为“小面额不足”的诊断提示 */
  greedyRemainder?: number;
  /** 不考虑张数上限时理论上凑成该金额所需的最少张数；大于 maxNotes 时说明张数上限挡死 */
  minNotesWithoutLimit?: number;
  /** 本次求解使用的单笔张数上限 */
  maxNotes?: number;
  /** 全部允许面额的可用总价值 */
  totalStockValue?: number;
  /** 允许面额的最大公约数（金额必须能被其整除） */
  gcd?: number;
}

export interface FeasibleResult {
  feasible: true;
  amount: number;
  maxNotes: number;
  /** 主推荐组合：优先大面额、总张数最少 */
  primary: SolveCombination;
  /** 备选组合（与主组合不同），不存在则为 null */
  alternative: SolveCombination | null;
  /** 不同可行组合的数量上限视图：>= CAP 时按 CAP 报告 */
  combinationCountAtLeast: number;
  hasMultiple: boolean;
}

export type SolveResult = FeasibleResult | InfeasibleExplanation;

const CAP = 255; // Uint8 表示；255 语义为“至少 255 个不同组合”

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * 分层“封顶可行解数”DP。
 *
 * layers[i] 表示只使用前 i 个（已按面额升序的）面额时的封顶解数层，
 * 形状 Uint8Array((A+1)*(L+1))，按 [a][k] 行优先排列。
 * 保留全部层是为了组合重建与备选组合分叉。
 */
function buildLayers(
  items: SolverDenom[],
  A: number,
  L: number,
): Uint8Array[] {
  const W = L + 1;
  const size = (A + 1) * W;
  const base = new Uint8Array(size);
  base[0] = 1; // 0 元、0 张：唯一空组合
  const layers: Uint8Array[] = [base];

  let prev = base;
  for (const item of items) {
    const d = item.denomination;
    const s = item.stock;
    const cur = new Uint8Array(size);

    // 转移沿对角线 a - k*d = c 进行；c 的取值范围 [-L*d, A]，
    // 映射到 a,k 网格内后按序滑动窗口即可。
    // 转移沿对角线 a - k*d = c 进行。网格内每条对角线的入口格满足
    // 前驱 (a-d, k-1) 在网格外：k=0（任意 a=0..A）或 a<d（a=0..d-1, k=1..L）。
    // 两组入口的 c 值（a 与 a-kd）互不重复，不会重复处理同一条对角线。
    for (let a0 = 0; a0 <= A; a0++) {
      processDiagonal(a0, 0);
    }
    const aLeftMax = Math.min(d - 1, A);
    for (let a0 = 0; a0 <= aLeftMax; a0++) {
      for (let k0 = 1; k0 <= L; k0++) {
        processDiagonal(a0, k0);
      }
    }

    function processDiagonal(aStart: number, kStart: number): void {
      // 窗口内容为窗口内 prev 状态的封顶计数；sat 为其中取值 CAP 的格子数。
      // 维护窗口 q 跨度：窗口包含沿对角线“最近的至多 s+1 个”且 k 非负、a 非负的点。
      let sum = 0;
      let sat = 0;
      let a = aStart;
      let k = kStart;
      // 窗口用环形队列记录每个进入窗口的值
      const qCap = s + 1;
      const win = new Uint8Array(qCap);
      let winLen = 0;
      let winHead = 0; // 下一个被移出的位置

      while (a <= A && k <= L) {
        // 进入窗口的点（对应当前 (a,k) 的 q=0 项 prev[a,k]）
        const v = prev[a * W + k];
        if (v === CAP) sat++;
        else sum += v;
        if (winLen < qCap) {
          win[(winHead + winLen) % qCap] = v;
          winLen++;
        } else {
          const old = win[winHead];
          if (old === CAP) sat--;
          else sum -= old;
          win[winHead] = v;
          winHead = (winHead + 1) % qCap;
        }
        cur[a * W + k] = sat > 0 ? CAP : sum > CAP ? CAP : sum;
        a += d;
        k += 1;
      }
    }

    layers.push(cur);
    prev = cur;
  }
  return layers;
}

/**
 * 给定层，判断取 q 张当前面额后，剩余状态在前一层是否可行。
 * 即 layers[i-1] 在 (a - q*d, k - q) 是否可达。
 */
function canTake(
  prevLayer: Uint8Array,
  W: number,
  a: number,
  k: number,
  d: number,
  q: number,
): boolean {
  const pa = a - q * d;
  const pk = k - q;
  if (pa < 0 || pk < 0) return false;
  return prevLayer[pa * W + pk] > 0;
}

/**
 * 组合重建：从第 i 层（已用面额 items[0..i-1]）目标 (a,k) 出发，
 * choose 决定当前面额取“第几大”的可行张数（0 = 最大可行张数）。
 * 返回从第 i 层到第 0 层各面额选取的张数（长度 i 的数组，按 items 顺序）。
 */
function reconstruct(
  layers: Uint8Array[],
  items: SolverDenom[],
  W: number,
  A: number,
  startLayer: number,
  startA: number,
  startK: number,
  choiceRank: number,
): number[] | null {
  const picks: number[] = new Array(startLayer).fill(0);
  let a = startA;
  let k = startK;
  for (let i = startLayer; i >= 1; i--) {
    const d = items[i - 1].denomination;
    const s = items[i - 1].stock;
    const maxQ = Math.min(s, Math.floor(a / d), k);
    // 收集所有可行的 q（当前面额取 q 张后，剩余可由前 i-1 个面额凑出）
    const prevLayer = layers[i - 1];
    // 从大到小枚举；choiceRank=0 选最大，1 选次大，以此类推
    let seen = -1;
    let chosen = -1;
    for (let q = maxQ; q >= 0; q--) {
      if (canTake(prevLayer, W, a, k, d, q)) {
        seen++;
        if (seen === choiceRank) {
          chosen = q;
          break;
        }
      }
    }
    if (chosen < 0) return null;
    picks[i - 1] = chosen;
    a -= chosen * d;
    k -= chosen;
  }
  if (a !== 0 || k !== 0) return null;
  return picks;
}

/**
 * 构造一个与“贪心主路径”不同的备选组合。
 *
 * 先沿每层“最大可行张数”走一遍主路径并记录每层进入时的 (a,k)；
 * 然后从最靠后的面额（最小面额）开始尝试在某一层改选“次大可行张数”，
 * 一旦分叉，前 i-1 个面额仍按贪心最大取法完成。
 * 这样既能找到最小面额处的分叉，也能找到 50 元“取/不取”等大面额处分叉。
 * 若相同最少张数内无分叉，返回 null，由调用方在更大的张数维度上再找。
 */
function reconstructAlternative(
  layers: Uint8Array[],
  items: SolverDenom[],
  W: number,
  A: number,
  startK: number,
): number[] | null {
  const n = items.length;
  // 主路径上的状态：stateAt[i] = 进入第 i 层（处理面额 items[i-1] 前）的 (a,k)
  const stateA = new Array<number>(n + 1);
  const stateK = new Array<number>(n + 1);
  const primaryQ = new Array<number>(n).fill(0);
  stateA[n] = A;
  stateK[n] = startK;
  for (let i = n; i >= 1; i--) {
    const d = items[i - 1].denomination;
    const s = items[i - 1].stock;
    let a = stateA[i];
    let k = stateK[i];
    const maxQ = Math.min(s, Math.floor(a / d), k);
    let qMax = -1;
    for (let q = maxQ; q >= 0; q--) {
      if (canTake(layers[i - 1], W, a, k, d, q)) {
        qMax = q;
        break;
      }
    }
    if (qMax < 0) return null;
    primaryQ[i - 1] = qMax;
    stateA[i - 1] = a - qMax * d;
    stateK[i - 1] = k - qMax;
  }

  // 从最小面额侧（i 小，即靠后的分叉在同一层；实际从 i=1 到 n 均可，
  // 这里从大面额侧 i=n 向小面额扫描，优先让备选与主组合“差异尽量靠小面额”，
  // 视觉上更接近“同一思路下的找零替换”）
  for (let i = n; i >= 1; i--) {
    const d = items[i - 1].denomination;
    const s = items[i - 1].stock;
    const a = stateA[i];
    const k = stateK[i];
    const maxQ = Math.min(s, Math.floor(a / d), k);
    const qPrimary = primaryQ[i - 1];
    let qAlt = -1;
    for (let q = maxQ; q >= 0; q--) {
      if (q === qPrimary) continue;
      if (canTake(layers[i - 1], W, a, k, d, q)) {
        qAlt = q;
        break;
      }
    }
    if (qAlt >= 0) {
      // 分叉层之后（更大面额，索引 >= i）沿用主路径取法
      const picks = new Array<number>(n).fill(0);
      for (let j = i; j < n; j++) picks[j] = primaryQ[j];
      picks[i - 1] = qAlt;
      // 前 i-1 个面额对剩余 (a-qAlt*d, k-qAlt) 贪心完成
      const tail = reconstruct(
        layers,
        items,
        W,
        A,
        i - 1,
        a - qAlt * d,
        k - qAlt,
        0,
      );
      if (tail) {
        for (let j = 0; j < i - 1; j++) picks[j] = tail[j];
        return picks;
      }
    }
  }
  return null;
}

function toCombination(
  items: SolverDenom[],
  picks: number[],
): SolveCombination {
  const counts: Record<number, number> = {};
  let notes = 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const q = picks[i] ?? 0;
    if (q > 0) {
      counts[items[i].denomination] = q;
      notes += q;
      total += q * items[i].denomination;
    }
  }
  return { counts, notes, total };
}

/**
 * 不考虑张数上限的有界可达金额 DP（按张二进制分解求 <= A 的最大可达金额）。
 * 用于无解时报告“最接近的可达金额/缺口”。
 */
function maxReachableAmount(items: SolverDenom[], A: number): number {
  // reach[a] = 金额 a 是否可达；按面额更新。
  // 有界数量用二进制分块（拆成 1,2,4,...,余数 张的“捆绑包”）。
  const reach = new Uint8Array(A + 1);
  reach[0] = 1;
  let maxReach = 0;
  for (const item of items) {
    let remaining = Math.min(item.stock, Math.floor(A / item.denomination));
    let chunk = 1;
    while (remaining > 0) {
      const take = Math.min(chunk, remaining);
      const value = take * item.denomination;
      for (let a = maxReach; a >= 0; a--) {
        if (reach[a] && a + value <= A) {
          reach[a + value] = 1;
          if (a + value > maxReach) maxReach = a + value;
        }
      }
      remaining -= take;
      chunk *= 2;
    }
  }
  for (let a = Math.min(A, maxReach); a >= 0; a--) {
    if (reach[a]) return a;
  }
  return 0;
}

/** 不考虑张数上限时，凑成 A 所需的理论最少张数（有界库存）；凑不出返回 null */
function minNotesForAmount(items: SolverDenom[], A: number): number | null {
  // 分层 DP：best[a] = 前若干面额凑 a 元的最少张数
  const INF = Number.POSITIVE_INFINITY;
  let best = new Float64Array(A + 1).fill(INF);
  best[0] = 0;
  for (const item of items) {
    const next = Float64Array.from(best);
    const d = item.denomination;
    const s = Math.min(item.stock, Math.floor(A / d));
    // 按余数分桶，窗口长度 s+1 的滑动最小值
    for (let r = 0; r < d && r <= A; r++) {
      // 单调队列：存索引 t（a = r + t*d），best[a]-t 单调递增
      const head: number[] = [];
      let hi = 0;
      for (let a = r, t = 0; a <= A; a += d, t++) {
        const val = best[a] - t;
        if (best[a] !== INF) {
          while (head.length > hi) {
            const tailT = head[head.length - 1];
            if (best[r + tailT * d] - tailT <= val) break;
            head.pop();
          }
          head.push(t);
        }
        // 移除窗口外（跨度 > s）的队首
        while (head.length > hi && head[hi] < t - s) hi++;
        if (head.length > hi) {
          const bt = head[hi];
          const cand = best[r + bt * d] + (t - bt);
          if (cand < next[a]) next[a] = cand;
        }
      }
    }
    best = next;
  }
  return best[A] === INF ? null : best[A];
}

/** 贪心诊断：允许面额从大到小尽量多取，返回凑不齐的尾差 */
function greedyRemainder(items: SolverDenom[], A: number): number {
  let remain = A;
  const desc = [...items].sort((x, y) => y.denomination - x.denomination);
  for (const item of desc) {
    const take = Math.min(item.stock, Math.floor(remain / item.denomination));
    remain -= take * item.denomination;
  }
  return remain;
}

/**
 * 主入口：求解一次取款的配钞组合。
 * 纯函数、有界整数算法，不触碰数据库/IO。
 */
export function solveBounded(req: SolveRequest): SolveResult {
  const { amount, maxNotes } = req;

  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      feasible: false,
      reasonCode: 'AMOUNT_INVALID',
      message: `取款金额必须为正整数（元），当前为 ${String(req.amount)}。`,
      amount: req.amount as number,
    };
  }
  if (!Number.isInteger(maxNotes) || maxNotes <= 0) {
    return {
      feasible: false,
      reasonCode: 'AMOUNT_INVALID',
      message: `单笔张数上限必须为正整数（张），当前为 ${String(maxNotes)}。`,
      amount,
    };
  }

  // 过滤允许面额，按面额升序（DP 与重建均依赖稳定顺序）
  const allowed = new Set(
    req.allowedDenominations && req.allowedDenominations.length > 0
      ? req.allowedDenominations
      : req.denoms.map((d) => d.denomination),
  );
  const items = req.denoms
    .filter(
      (d) =>
        allowed.has(d.denomination) &&
        Number.isInteger(d.denomination) &&
        d.denomination > 0 &&
        Number.isInteger(d.stock) &&
        d.stock >= 0,
    )
    .sort((x, y) => x.denomination - y.denomination);

  if (items.length === 0) {
    return {
      feasible: false,
      reasonCode: 'NO_DENOMINATION',
      message: '没有选择任何允许且有库存记录的面额，无法配钞。',
      amount,
    };
  }

  const totalStockValue = items.reduce(
    (sum, it) => sum + it.denomination * it.stock,
    0,
  );
  const g = items.reduce((acc, it) => gcd(acc, it.denomination), 0);

  // ---- 廉价的必要条件快判（不跑全量 DP 也能解释一部分无解） ----
  if (totalStockValue < amount) {
    return {
      feasible: false,
      reasonCode: 'INSUFFICIENT_TOTAL_STOCK',
      message: `允许面额的可用总价值为 ${totalStockValue} 元，少于取款金额 ${amount} 元，缺口 ${amount - totalStockValue} 元。`,
      amount,
      totalStockValue,
      shortage: amount - totalStockValue,
      gcd: g,
    };
  }
  if (amount % g !== 0) {
    return {
      feasible: false,
      reasonCode: 'GCD_NOT_DIVISIBLE',
      message: `取款金额 ${amount} 不能被允许面额的最大公约数 ${g} 整除，无论库存多少都无法凑出。`,
      amount,
      gcd: g,
      totalStockValue,
    };
  }

  // 不考虑张数上限：最大可达金额 / 理论最少张数（用于精确解释）
  const maxReach = maxReachableAmount(items, amount);
  const minNotes = minNotesForAmount(items, amount);

  if (maxReach < amount) {
    const shortage = amount - maxReach;
    const rem = greedyRemainder(items, amount);
    // 小面额不足的启发式诊断：贪心优先大面额后留下一个“小额尾差”无法消化。
    // 典型为尾差 < 最小允许面额（缺 1/5/10 元找零）；放宽到 50 元，
    // 覆盖“50 元钞箱空、100 元取完后剩几十元尾差”的场景。
    const smallest = items[0].denomination;
    const tailThreshold = Math.max(50, smallest);
    const smallShort = rem > 0 && rem < tailThreshold && maxReach > 0;
    return {
      feasible: false,
      reasonCode: smallShort ? 'SMALL_DENOM_SHORTAGE' : 'NO_COMBINATION',
      message: smallShort
        ? `小面额（找零）钞箱不足：优先使用大面额后还剩 ${rem} 元尾差无法消化，而小面额余量不够补齐；精确计 DP 显示允许面额最多只能凑到 ${maxReach} 元，距 ${amount} 元还差 ${shortage} 元。请补充小面额或调整金额。`
        : `库存组合无法精确凑出 ${amount} 元：允许面额最多只能凑到 ${maxReach} 元，还差 ${shortage} 元（允许面额中最小为 ${smallest} 元）。`,
      amount,
      maxReachableBelow: maxReach,
      shortage,
      greedyRemainder: rem,
      minNotesWithoutLimit: minNotes ?? undefined,
      totalStockValue,
      gcd: g,
    };
  }

  // maxReach === amount：存在不考虑张数上限的组合，检查张数上限
  if (minNotes !== null && minNotes > maxNotes) {
    return {
      feasible: false,
      reasonCode: 'NOTE_LIMIT',
      message: `凑出 ${amount} 元理论上最少需要 ${minNotes} 张，超过单笔张数上限 ${maxNotes} 张（小面额库存过多、大面额不足所致）。`,
      amount,
      minNotesWithoutLimit: minNotes,
      maxNotes,
      totalStockValue,
      gcd: g,
    };
  }

  // ---- 全量分层 DP：在“有张数上限”约束下求可行组合 ----
  const L = maxNotes;
  const A = amount;
  const layers = buildLayers(items, A, L);
  const W = L + 1;
  const last = layers[items.length];

  // 在所有 k <= L 中找可行状态；优先最小 k（最少张数）
  let bestK = -1;
  for (let k = 0; k <= L; k++) {
    if (last[A * W + k] > 0) {
      bestK = k;
      break;
    }
  }
  if (bestK < 0) {
    // 理论上不应发生（前面已做无张数限制可达 + 最少张数判断），兜底解释
    return {
      feasible: false,
      reasonCode: 'NO_COMBINATION',
      message: `库存组合无法在单笔 ${maxNotes} 张上限内凑出 ${amount} 元。`,
      amount,
      maxReachableBelow: maxReach,
      minNotesWithoutLimit: minNotes ?? undefined,
      maxNotes,
      totalStockValue,
      gcd: g,
    };
  }

  const totalWaysCapped = last[A * W + bestK]; // 最少张数这一层的封顶解数
  const primaryPicks = reconstruct(
    layers,
    items,
    W,
    A,
    items.length,
    A,
    bestK,
    0,
  );
  if (!primaryPicks) {
    return {
      feasible: false,
      reasonCode: 'NO_COMBINATION',
      message: '组合重建失败（内部错误）。',
      amount,
    };
  }

  // 备选组合：先在“相同最少张数”下沿主路径找最早可行分叉；
  // 若最少张数只有一种，再尝试张数更多（k+1..L）的任意可行组合。
  let altPicks: number[] | null = reconstructAlternative(
    layers,
    items,
    W,
    A,
    bestK,
  );
  if (!altPicks) {
    for (let k = bestK + 1; k <= L && !altPicks; k++) {
      if (last[A * W + k] > 0) {
        altPicks = reconstruct(layers, items, W, A, items.length, A, k, 0);
      }
    }
  }

  const primary = toCombination(items, primaryPicks);
  const alternative = altPicks ? toCombination(items, altPicks) : null;

  // 全部张数维度上的封顶组合数（用于“至少 N 个组合”的展示）
  let waysAll = 0;
  for (let k = 0; k <= L; k++) {
    const v = last[A * W + k];
    if (v === CAP) {
      waysAll = CAP;
      break;
    }
    waysAll += v;
    if (waysAll >= CAP) {
      waysAll = CAP;
      break;
    }
  }

  return {
    feasible: true,
    amount,
    maxNotes,
    primary,
    alternative,
    combinationCountAtLeast: waysAll || totalWaysCapped || 1,
    hasMultiple: alternative !== null,
  };
}

export const SOLVER_CAP = CAP;
