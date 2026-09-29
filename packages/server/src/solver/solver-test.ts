/* 临时对照测试：solveBounded 与暴力枚举结果一致性 */
import { solveBounded, SolverDenom } from './bounded-solver';

function brute(
  items: SolverDenom[],
  A: number,
  L: number,
): { feasible: boolean; count: number; minNotes: number; samples: string[] } {
  const counts = new Map<number, number>();
  let feasible = false;
  let count = 0;
  let minNotes = Infinity;
  const samples: string[] = [];
  const n = items.length;
  const idx = new Array(n).fill(0);
  const maxQ = items.map((it) => Math.min(it.stock, Math.floor(A / it.denomination)));

  function emit(): void {
    let total = 0;
    let notes = 0;
    for (let i = 0; i < n; i++) {
      total += items[i].denomination * idx[i];
      notes += idx[i];
    }
    if (total === A && notes <= L) {
      feasible = true;
      count++;
      if (notes < minNotes) minNotes = notes;
      if (samples.length < 3) samples.push(JSON.stringify(idx.slice()));
    }
  }

  function rec(i: number, usedNotes: number, usedValue: number): void {
    if (i === n) {
      if (usedValue === A) emit();
      return;
    }
    for (let q = 0; q <= maxQ[i] && usedNotes + q <= L && usedValue + q * items[i].denomination <= A; q++) {
      idx[i] = q;
      rec(i + 1, usedNotes + q, usedValue + q * items[i].denomination);
    }
    idx[i] = 0;
  }
  rec(0, 0, 0);
  return { feasible, count, minNotes: feasible ? minNotes : -1, samples };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let failures = 0;
let cases = 0;
const rand = rng(42);
const denomPool = [1, 5, 10, 20, 50, 100];

for (let t = 0; t < 1500; t++) {
  const n = 1 + Math.floor(rand() * 4); // 1..4 种面额
  const shuffled = [...denomPool].sort(() => rand() - 0.5);
  const chosen = shuffled.slice(0, n).sort((a, b) => a - b);
  const items: SolverDenom[] = chosen.map((d) => ({
    denomination: d,
    stock: Math.floor(rand() * 6), // 0..5 张
  }));
  const A = 1 + Math.floor(rand() * 120);
  const L = 1 + Math.floor(rand() * 12);
  const res = solveBounded({ amount: A, maxNotes: L, denoms: items });
  const exp = brute(items, A, L);
  cases++;

  if (res.feasible !== exp.feasible) {
    failures++;
    console.log('FEAS MISMATCH', { items, A, L, got: res.feasible, exp });
    if (failures > 8) break;
    continue;
  }
  if (res.feasible) {
    // 主组合金额/张数校验
    const p = res.primary;
    if (p.total !== A || p.notes > L) {
      failures++;
      console.log('BAD PRIMARY', { items, A, L, p });
      continue;
    }
    for (const [d, q] of Object.entries(p.counts)) {
      const it = items.find((x) => x.denomination === Number(d));
      if (!it || q > it.stock) {
        failures++;
        console.log('PRIMARY EXCEEDS STOCK', { items, A, L, p });
        break;
      }
    }
    // 最少张数
    if (p.notes !== exp.minNotes) {
      failures++;
      console.log('MIN NOTES MISMATCH', { items, A, L, got: p.notes, exp: exp.minNotes });
    }
    // 备选与主组合不同，且备选也合法
    if (res.alternative) {
      const alt = res.alternative;
      if (alt.total !== A || alt.notes > L) {
        failures++;
        console.log('BAD ALT', { items, A, L, alt });
      }
      if (JSON.stringify(alt.counts) === JSON.stringify(p.counts)) {
        failures++;
        console.log('ALT SAME AS PRIMARY', { items, A, L, p });
      }
    }
    // 多组合标记一致性
    if (exp.count > 1 !== res.hasMultiple) {
      failures++;
      console.log('HASMULT MISMATCH', {
        items, A, L, expCount: exp.count, got: res.hasMultiple,
      });
    }
    // 计数（未封顶时必须精确）
    if (exp.count < 255 && res.combinationCountAtLeast !== Math.min(exp.count, 255)) {
      failures++;
      console.log('COUNT MISMATCH', { items, A, L, exp: exp.count, got: res.combinationCountAtLeast });
    }
  }
}

// 定向场景：小面额不足
{
  const items: SolverDenom[] = [
    { denomination: 1, stock: 2 },
    { denomination: 5, stock: 10 },
    { denomination: 10, stock: 10 },
  ];
  const r = solveBounded({ amount: 99, maxNotes: 50, denoms: items });
  console.log('small-short 99 ->', r.feasible ? 'FEAS' : r.reasonCode, r.feasible ? '' : (r as any).shortage);
  if (r.feasible || (r as any).reasonCode !== 'SMALL_DENOM_SHORTAGE') failures++;
}

// 定向场景：存在多个可行组合
{
  const items: SolverDenom[] = [
    { denomination: 1, stock: 20 },
    { denomination: 5, stock: 10 },
    { denomination: 10, stock: 10 },
  ];
  const r = solveBounded({ amount: 20, maxNotes: 20, denoms: items });
  console.log('multi 20 ->', r.feasible, 'hasMultiple=', (r as any).hasMultiple, 'atLeast=', (r as any).combinationCountAtLeast, 'primary=', JSON.stringify((r as any).primary.counts), 'alt=', JSON.stringify((r as any).alternative?.counts));
  if (!r.feasible || !(r as any).hasMultiple) failures++;
}

console.log(`\ncases=${cases} failures=${failures}`);
process.exit(failures ? 1 : 0);
