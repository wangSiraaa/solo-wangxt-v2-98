import { PlannerService } from '../src/cash/planner.service';

/** 暴力枚举所有满足库存/张数上限的组合，按张数排序，返回前 limit 个 */
function bruteForce(
  amount: number,
  denomsDesc: { denomination: number; available: number }[],
  maxNotes: number,
  limit: number,
) {
  const out: { counts: number[]; notes: number }[] = [];
  const counts = new Array(denomsDesc.length).fill(0);
  const dfs = (k: number, remain: number, notes: number) => {
    if (out.length >= limit) return;
    if (k === denomsDesc.length) {
      if (remain === 0) out.push({ counts: [...counts], notes });
      return;
    }
    const d = denomsDesc[k].denomination;
    const cMax = Math.min(denomsDesc[k].available, Math.floor(remain / d), maxNotes - notes);
    for (let c = cMax; c >= 0; c--) {
      counts[k] = c;
      dfs(k + 1, remain - c * d, notes + c);
      if (out.length >= limit) return;
    }
    counts[k] = 0;
  };
  dfs(0, amount, 0);
  out.sort((a, b) => a.notes - b.notes);
  return out;
}

describe('PlannerService 与暴力枚举对照（随机有界实例）', () => {
  test('200 个随机实例：可行性与前 5 组合完全一致', () => {
    const planner = new PlannerService();
    let seed = 20260928;
    const rnd = () => {
      // 确定性 LCG
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const palette = [100, 200, 500, 1000];
    for (let t = 0; t < 200; t++) {
      const k = 1 + Math.floor(rnd() * palette.length);
      const denoms = [...palette].sort(() => rnd() - 0.5).slice(0, k).sort((a, b) => b - a);
      const stocks = denoms.map((denomination) => ({
        denomination,
        available: Math.floor(rnd() * 10),
      }));
      const amount = Math.floor(rnd() * 12000) + 100;
      const maxNotes = 1 + Math.floor(rnd() * 40);

      const res = planner.plan(amount, stocks, maxNotes, 5);
      const bf = bruteForce(amount, stocks, maxNotes, 5);

      if (bf.length === 0) {
        expect(res.feasible).toBe(false);
      } else {
        expect(res.feasible).toBe(true);
        expect(res.solutions).toHaveLength(Math.min(5, bf.length));
        for (let i = 0; i < res.solutions.length; i++) {
          expect(res.solutions[i].totalNotes).toBe(bf[i].notes);
          const solCounts = denoms.map((d) => {
            const line = res.solutions[i].lines.find((l) => l.denomination === d);
            return line ? line.count : 0;
          });
          expect(solCounts).toEqual(bf[i].counts);
        }
      }
    }
  });
});
