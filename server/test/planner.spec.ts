import { PlannerService } from '../src/cash/planner.service';

describe('PlannerService 有界整数配钞', () => {
  let planner: PlannerService;
  // 默认库存（分）：100x8, 200x12, 500x30, 1000x40
  const stock = [
    { denomination: 100, available: 8 },
    { denomination: 200, available: 12 },
    { denomination: 500, available: 30 },
    { denomination: 1000, available: 40 },
  ];

  beforeEach(() => {
    planner = new PlannerService();
  });

  test('可行：¥86 枚举出多个组合且 0 号张数最少（大面额优先）', () => {
    const res = planner.plan(8600, stock, 50);
    expect(res.feasible).toBe(true);
    // ¥86 = 1000x + 500a+200b+100c
    //   10 张：1000x8 + (500+100)
    //   11 张：1000x8 + (200x2+100x2 / 200+100x4)
    //   12 张：1000x8 + 100x6；1000x7 + 500x3 + 100
    expect(res.solutions.length).toBe(5);
    expect(res.solutions.map((s) => s.totalNotes)).toEqual([10, 11, 11, 12, 12]);
    expect(res.solutions[0].lines).toEqual([
      { denomination: 1000, count: 8 },
      { denomination: 500, count: 1 },
      { denomination: 100, count: 1 },
    ]);
    // 每个组合金额都必须精确等于目标（整数分）
    for (const s of res.solutions) {
      const sum = s.lines.reduce((acc, l) => acc + l.denomination * l.count, 0);
      expect(sum).toBe(8600);
      expect(s.totalNotes).toBeLessThanOrEqual(50);
    }
  });

  test('可行：无 1000 面额时 ¥86 也有多个组合，18 张 1 个 / 19 张 1 个 / 20 张 1 个 / 21 张 2 个', () => {
    const small = stock.filter((s) => s.denomination <= 500);
    const res = planner.plan(8600, small, 50);
    expect(res.feasible).toBe(true);
    // 5a+2b+c=86：18张(17,0,1) 19张(16,3,0) 20张(16,2,2)
    //             21张(16,1,4) 与 (15,5,1)
    expect(res.solutions.map((s) => s.totalNotes)).toEqual([18, 19, 20, 21, 21]);
    expect(res.solutions[4].lines).toEqual([
      { denomination: 500, count: 15 },
      { denomination: 200, count: 5 },
      { denomination: 100, count: 1 },
    ]);
  });

  test('粒度缺口：¥27 只用 500/1000（gcd=500），余 200 分无法凑', () => {
    const res = planner.plan(
      2700,
      stock.filter((s) => s.denomination === 500 || s.denomination === 1000),
      50,
    );
    expect(res.feasible).toBe(false);
    expect(res.reason!.code).toBe('DENOMINATION_GAP');
    expect(res.reason!.gcdGap).toBe(200);
  });

  test('小面额库存不足：¥10 全部用 100 面额但只有 8 张', () => {
    const res = planner.plan(1000, [{ denomination: 100, available: 8 }], 50);
    expect(res.feasible).toBe(false);
    expect(res.reason!.code).toBe('INSUFFICIENT_STOCK');
    expect(res.reason!.maxReachableCents).toBe(800);
    expect(res.reason!.shortMissingCents).toBe(200);
  });

  test('小面额紧张的批内竞争：第一笔取走仅有的零钱后，第二笔只能用零钱 -> 不可行并解释缺口', () => {
    // 第一笔只允许 {500,200,100} 凑 ¥86：最优 500x17 + 100x1（18 张）
    const first = planner.plan(8600, stock.filter((s) => s.denomination <= 500), 50);
    expect(first.feasible).toBe(true);
    const stockAfter = stock.map((s) =>
      s.denomination === 500
        ? { ...s, available: s.available - 17 }
        : s.denomination === 100
          ? { ...s, available: s.available - 1 }
          : s,
    );
    // 第二笔只允许 {200,100}：最多 12x200 + 7x100 = 3100 < 8600
    const second = planner.plan(
      8600,
      stockAfter.filter((s) => s.denomination === 200 || s.denomination === 100),
      50,
    );
    expect(second.feasible).toBe(false);
    expect(second.reason!.code).toBe('INSUFFICIENT_STOCK');
    expect(second.reason!.maxReachableCents).toBe(3100);
    expect(second.reason!.shortMissingCents).toBe(5500);
    const bindingDenoms = second.reason!.binding!.map((b) => b.denomination).sort();
    expect(bindingDenoms).toEqual([100, 200]);
  });

  test('粒度缺口：面额 200/500（gcd=100）凑不出 250 分', () => {
    const res = planner.plan(250, [
      { denomination: 200, available: 10 },
      { denomination: 500, available: 10 },
    ], 50);
    expect(res.feasible).toBe(false);
    expect(res.reason!.code).toBe('DENOMINATION_GAP');
    expect(res.reason!.gcdGap).toBe(50);
  });

  test('张数上限：¥100 用 100 面额需 100 张，上限 50', () => {
    const res = planner.plan(10000, [{ denomination: 100, available: 1000 }], 50);
    expect(res.feasible).toBe(false);
    expect(res.reason!.code).toBe('NOTE_LIMIT');
  });

  test('库存上限导致张数区间被截断但仍可行：枚举张数必须都 ≤ maxNotes', () => {
    // 1000x1 + 100 库存 3 张：1300 只有一个组合
    const res = planner.plan(
      1300,
      [
        { denomination: 1000, available: 1 },
        { denomination: 100, available: 3 },
      ],
      50,
    );
    expect(res.feasible).toBe(true);
    expect(res.solutions).toHaveLength(1);
    expect(res.solutions[0].lines).toEqual([
      { denomination: 1000, count: 1 },
      { denomination: 100, count: 3 },
    ]);
  });

  test('边界：0 张可用面额 → EMPTY_DENOMINATION', () => {
    const res = planner.plan(500, [{ denomination: 500, available: 0 }], 10);
    expect(res.feasible).toBe(false);
    expect(res.reason!.code).toBe('EMPTY_DENOMINATION');
  });
});
