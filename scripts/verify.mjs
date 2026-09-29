#!/usr/bin/env node
/**
 * 端到端核对脚本：对运行中的 API（默认 http://127.0.0.1:3000）执行
 *
 *   样例 A：小面额不足（1 元钞箱仅 3 张）
 *     - 97 元可行但需要 ≥2 张 1 元；104 元无解，报告“只差 1 元”
 *     - 含 99/104 的批次必须整批回滚，钞箱库存逐张不变
 *
 *   样例 B：存在多个可行组合
 *     - 100 元至少有 100×1 / 50×2 / 20×5…，主组合与备选不同且都精确等于金额
 *     - 批次预占 → 成功出钞，核对：钞箱减量 == 计划张数
 *
 *   样例 C：拒钞 / 未完成的结果核对
 *     - 计划金额 = 实际交付 + 拒钞 + 未完成；钞箱口径不变式恒成立
 *     - “请求成功”绝不被当作现金已交付
 *
 * 退出码 0 表示全部断言通过。
 */

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

let failures = 0;
let passed = 0;

function assert(cond, msg, extra) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
    if (extra !== undefined) console.log('    ', JSON.stringify(extra));
  }
}

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return json;
}

function comboAmount(counts) {
  return Object.entries(counts).reduce(
    (s, [d, q]) => s + Number(d) * q,
    0,
  );
}
function comboNotes(counts) {
  return Object.values(counts).reduce((s, q) => s + q, 0);
}
function cassetteMap(cs) {
  return new Map(cs.map((c) => [c.denomination, c]));
}
function totalsOfRes(list) {
  const m = new Map();
  for (const r of list) {
    for (const [d, q] of Object.entries(r.planCounts)) {
      m.set(Number(d), (m.get(Number(d)) ?? 0) + q);
    }
  }
  return m;
}

async function main() {
  console.log('\n=== 准备：重置为种子钞箱 ===');
  await call('POST', '/api/admin/reset', {});
  const before = cassetteMap(await call('GET', '/api/cassettes'));
  assert(before.get(1).stockAvailable === 3, '种子数据：1 元钞箱仅 3 张（制造小面额不足）');
  assert(before.get(100).stockAvailable === 40, '种子数据：100 元钞箱 40 张');

  console.log('\n=== 样例 A：小面额不足 ===');
  const a97 = await call('POST', '/api/evaluate', { amount: 97, maxNotes: 50 });
  assert(a97.feasible, '97 元可行（1 元需求 ≤ 3 张）', a97);
  if (a97.feasible) {
    assert(comboAmount(a97.primary.counts) === 97, '97 元主组合金额精确等于 97');
    assert((a97.primary.counts['1'] ?? 0) <= 3, '97 元主组合占用 1 元不超过 3 张');
  }

  const a104 = await call('POST', '/api/evaluate', { amount: 104, maxNotes: 50 });
  assert(!a104.feasible, '104 元无可行组合', a104);
  assert(a104.reasonCode === 'SMALL_DENOM_SHORTAGE', '原因归类为小面额（找零）不足', a104.reasonCode);
  assert(a104.shortage === 1, '明确解释缺少的金额 = 1 元（最多凑到 103）', {
    shortage: a104.shortage,
    maxReachableBelow: a104.maxReachableBelow,
  });

  const a96 = await call('POST', '/api/evaluate', { amount: 96, maxNotes: 50 });
  assert(a96.feasible, '对照：96 元只需 1 张 1 元，可行（证明 104 无解确系小面额不够）', a96);

  // 含不可行笔的批次：必须整批回滚、库存零改动
  const snapshotBefore = await call('GET', '/api/cassettes');
  const rb = await call('POST', '/api/reserve', {
    requests: [
      { amount: 300, maxNotes: 50 },
      { amount: 97, maxNotes: 50 },
      { amount: 104, maxNotes: 50 },
    ],
  });
  assert(rb.status === 'ROLLED_BACK', '含 104 元的批次整批 ROLLED_BACK', rb.status);
  assert(rb.failedAtSeq === 2, '失败定位到第 3 笔（seq=2，前两笔可行）', rb.failedAtSeq);
  const snapshotAfter = await call('GET', '/api/cassettes');
  const unchanged = snapshotAfter.every((c) => {
    const b = cassetteMap(snapshotBefore).get(c.denomination);
    return (
      b.stockAvailable === c.stockAvailable &&
      b.stockReserved === c.stockReserved
    );
  });
  assert(unchanged, '回滚后所有钞箱可用/预占张数逐张不变');

  // 99 元也需要 4 张 1 元（50+20+20+5+4），库存仅 3 张 → 同样无解
  const a99 = await call('POST', '/api/evaluate', { amount: 99, maxNotes: 50 });
  assert(!a99.feasible && a99.reasonCode === 'SMALL_DENOM_SHORTAGE',
    '99 元同样因 1 元不足无解（需 4 张、仅 3 张）', a99.reasonCode);
  assert(a99.shortage === 1, '99 元缺少金额 = 1 元（最多凑到 98）', {
    shortage: a99.shortage,
    maxReachableBelow: a99.maxReachableBelow,
  });

  console.log('\n=== 样例 B：存在多个可行组合 ===');
  const b100 = await call('POST', '/api/evaluate', { amount: 100, maxNotes: 50 });
  assert(b100.feasible, '100 元可行', b100);
  assert(b100.hasMultiple && b100.alternative, '存在多个可行组合并返回备选');
  assert(comboAmount(b100.primary.counts) === 100, '主组合金额 = 100');
  assert(comboAmount(b100.alternative.counts) === 100, '备选组合金额 = 100');
  assert(
    JSON.stringify(b100.primary.counts) !== JSON.stringify(b100.alternative.counts),
    '主组合与备选确实不同',
    { p: b100.primary.counts, a: b100.alternative.counts },
  );
  assert(
    comboNotes(b100.primary.counts) <= comboNotes(b100.alternative.counts),
    '主组合张数 ≤ 备选张数（优先少张数/大面额）',
    { p: comboNotes(b100.primary.counts), a: comboNotes(b100.alternative.counts) },
  );
  // 库存上界尊重：主/备选各面额占用都不超过库存
  for (const [d, q] of Object.entries(b100.primary.counts))
    assert(q <= before.get(Number(d)).stockAvailable, `主组合 ${d} 元占用 ${q} ≤ 库存`);

  // 多组合批次：100 / 200(仅100,50,20) / 50，全部预占成功
  const planB = await call('POST', '/api/plan', {
    requests: [
      { amount: 100, maxNotes: 50 },
      { amount: 200, maxNotes: 50, allowedDenominations: [100, 50, 20] },
      { amount: 50, maxNotes: 50 },
    ],
  });
  assert(planB.feasibleCount === 3, '多组合批次 3/3 可行');
  assert(
    planB.items[1].result.alternative &&
      JSON.stringify(planB.items[1].result.primary.counts) !==
        JSON.stringify(planB.items[1].result.alternative.counts),
    '200 元（100/50/20）同样有多个组合',
  );

  const preReserve = cassetteMap(await call('GET', '/api/cassettes'));
  const resB = await call('POST', '/api/reserve', {
    requests: [
      { amount: 100, maxNotes: 50 },
      { amount: 200, maxNotes: 50, allowedDenominations: [100, 50, 20] },
      { amount: 50, maxNotes: 50 },
    ],
  });
  assert(resB.status === 'RESERVED', '多组合批次预占成功', resB);
  const afterReserve = cassetteMap(await call('GET', '/api/cassettes'));
  const need = totalsOfRes(resB.reservations);
  let reserveDeltaOk = true;
  for (const [d, q] of need) {
    const availDrop =
      preReserve.get(d).stockAvailable - afterReserve.get(d).stockAvailable;
    const resGain =
      afterReserve.get(d).stockReserved - preReserve.get(d).stockReserved;
    if (availDrop !== q || resGain !== q) reserveDeltaOk = false;
    assert(
      availDrop === q && resGain === q,
      `${d} 元：可用减少 ${availDrop}、预占增加 ${resGain}，均 == 计划占用 ${q}`,
    );
  }
  assert(reserveDeltaOk, '预占张数逐面额与计划一致（请求成功≠交付，此阶段 delivered=0）');
  assert(
    [...afterReserve.values()].every((c) => c.stockDelivered === 0),
    '预占阶段没有任何现金被当作已交付',
  );

  const dispB = await call('POST', `/api/batches/${resB.batchId}/dispense`, {
    mode: 'success',
  });
  assert(dispB.results.every((r) => r.status === 'DISPENSED'), '全部成功模式：3 笔均 DISPENSED');
  assert(
    dispB.results.every((r) => r.deliveredAmount === r.requestedAmount),
    '实际交付金额逐笔 == 申请金额',
    dispB.results.map((r) => [r.requestedAmount, r.deliveredAmount]),
  );
  const afterDisp = cassetteMap(await call('GET', '/api/cassettes'));
  let deliveredDeltaOk = true;
  for (const [d, q] of need) {
    const delivered = afterDisp.get(d).stockDelivered;
    const reservedCleared = afterDisp.get(d).stockReserved === 0;
    const avail = afterDisp.get(d).stockAvailable;
    const expectAvail = preReserve.get(d).stockAvailable - q;
    if (delivered !== q || !reservedCleared || avail !== expectAvail)
      deliveredDeltaOk = false;
    assert(
      delivered === q && reservedCleared && avail === expectAvail,
      `${d} 元：交付累计 ${delivered}==${q}，预占清零，可用 ${avail}==${expectAvail}`,
    );
  }
  assert(deliveredDeltaOk, '成功出钞后：交付 == 计划，预占归零，可用口径守恒');

  console.log('\n=== 样例 C：拒钞 / 未完成（不能把请求成功当交付）===');
  const resC = await call('POST', '/api/reserve', {
    requests: [{ amount: 500, maxNotes: 50 }, { amount: 300, maxNotes: 50 }],
  });
  assert(resC.status === 'RESERVED', 'C 批次预占成功');
  const beforeC = cassetteMap(await call('GET', '/api/cassettes'));
  const needC = totalsOfRes(resC.reservations);

  const dispC = await call('POST', `/api/batches/${resC.batchId}/dispense`, {
    mode: 'reject',
  });
  assert(
    dispC.results.every((r) => r.status === 'FAILED' && r.deliveredAmount === 0),
    '全部拒钞：状态 FAILED，交付金额全部为 0（HTTP 200 也不代表现金交付）',
  );
  assert(
    dispC.results.every(
      (r) => r.rejectedAmount + r.unfinishedAmount === r.requestedAmount,
    ),
    '拒钞模式：拒钞+未完成 == 计划金额',
  );
  const afterC = cassetteMap(await call('GET', '/api/cassettes'));
  for (const [d, q] of needC) {
    const c = afterC.get(d);
    assert(
      c.stockReserved === 0 && c.stockRejected - beforeC.get(d).stockRejected === q,
      `${d} 元：预占清零、拒钞增加 ${q} 张`,
      { reserved: c.stockReserved, rejected: c.stockRejected },
    );
  }

  // 钞箱抽空：未完成数量必须释放回可用
  const preD = cassetteMap(await call('GET', '/api/cassettes')); // 预占前
  const resD = await call('POST', '/api/reserve', {
    requests: [{ amount: 400, maxNotes: 50 }],
  });
  const beforeD = cassetteMap(await call('GET', '/api/cassettes')); // 预占后、结算前
  assert(beforeD.get(100).stockReserved >= 4, 'D 批次预占后 100 元在途预占 ≥4');
  assert(
    preD.get(100).stockAvailable - beforeD.get(100).stockAvailable === 4,
    '预占时刻：100 元可用立即减少 4 张',
  );
  const dispD = await call('POST', `/api/batches/${resD.batchId}/dispense`, {
    mode: 'shortage',
    shortageRatio: 0.25,
  });
  const rD = dispD.results[0];
  assert(
    rD.deliveredAmount + rD.rejectedAmount + rD.unfinishedAmount === 400,
    '部分交付：交付 + 拒钞 + 未完成 = 计划金额 400',
    [rD.deliveredAmount, rD.rejectedAmount, rD.unfinishedAmount],
  );
  assert(rD.status === 'PARTIAL', '存在未完成数量 → PARTIAL 状态');
  const afterD = cassetteMap(await call('GET', '/api/cassettes'));
  const d100 = afterD.get(100);
  // 400 元主组合 = 100x4；25% 未完成 = 1 张释放
  const unfinished100 = rD.unfinishedCounts['100'] ?? 0;
  const delivered100 = rD.deliveredCounts['100'] ?? 0;
  const rejected100 = rD.rejectedCounts['100'] ?? 0;
  assert(
    delivered100 + rejected100 + unfinished100 === 4 &&
      unfinished100 === 1 &&
      delivered100 === 3,
    '100 元：计划4 = 交付3 + 未完成1（确定性模拟）',
    rD,
  );
  assert(
    d100.stockReserved === 0 &&
      d100.stockDelivered - beforeD.get(100).stockDelivered === 3,
    '结算后 100 元预占清零、交付仅 +3（未完成的 1 张没算交付）',
  );
  // 未完成释放的两个核对方向：
  //  1) 相对预占时刻：结算后可用回升 = 未完成 1 张（预占解除）
  //  2) 相对批次开始：可用仅净减 = 实际交付 3 张（未完成不计交付、不算消耗）
  const reboundVsReserved = d100.stockAvailable - beforeD.get(100).stockAvailable;
  assert(
    reboundVsReserved === 1,
    `结算后未完成的 1 张释放回可用（较预占时刻回升 1，实测 ${reboundVsReserved}）`,
  );
  const availDrop = preD.get(100).stockAvailable - d100.stockAvailable;
  assert(availDrop === 3, `较批次开始可用仅净减 3（=实际交付，实测 ${availDrop}）`);

  console.log('\n=== 样例 D：并发争抢（行锁 + 条件更新防超卖）===');
  await call('POST', '/api/admin/reset', {});
  // 两个各需 30 张 100 元（合计 60 > 库存 40）的批次并发提交
  const contentionBody = {
    requests: Array.from({ length: 3 }, () => ({
      amount: 1000,
      maxNotes: 50,
      allowedDenominations: [100],
    })),
  };
  const [c1, c2] = await Promise.all([
    call('POST', '/api/reserve', contentionBody),
    call('POST', '/api/reserve', contentionBody),
  ]);
  const winner = [c1, c2].filter((c) => c.status === 'RESERVED');
  const loser = [c1, c2].filter((c) => c.status === 'ROLLED_BACK');
  assert(winner.length === 1, `并发两批次恰有一个成功（成功 ${winner.length} 个）`, {
    c1: c1.status,
    c2: c2.status,
  });
  assert(loser.length === 1, '另一个整批回滚（无部分预占、无脏数据）');
  const contended = cassetteMap(await call('GET', '/api/cassettes')).get(100);
  assert(
    contended.stockReserved === 30 && contended.stockAvailable === 10,
    `100 元恰好预占 30 张、可用 10 张（不超卖），实测 reserved=${contended.stockReserved} available=${contended.stockAvailable}`,
  );

  console.log('\n=== 全局核对（不变式）===');
  const rec = await call('GET', '/api/reconciliation');
  assert(rec.invariantCheck.ok, '核对接口：库存口径不变式全部成立', rec.invariantCheck.violations);
  const valueConserved =
    rec.totals.availableValue +
      rec.totals.reservedValue +
      rec.totals.deliveredValue +
      rec.totals.rejectedValue ===
    rec.totals.stockTotalValue;
  assert(valueConserved, '价值守恒：可用+预占+已交付+拒钞 = 钞箱总价值', rec.totals);
  // 所有已结算预占：计划 == 交付+拒钞+未完成
  const recRows = rec.reservations.filter((r) => r.status !== 'RESERVED');
  const perRowOk = recRows.every(
    (r) =>
      r.planAmount === r.deliveredAmount + r.rejectedAmount + r.unfinishedAmount,
  );
  assert(perRowOk, `逐笔守恒（${recRows.length} 笔已结算）：计划 = 交付 + 拒钞 + 未完成`);

  console.log(`\n===== 结果：${passed} 通过, ${failures} 失败 =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
