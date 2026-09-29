/* eslint-disable no-console */
// 完整 HTTP 联调：小面额不足 + 多组合 + 事务预占(回滚/部分) + 出钞三态 + 核对
const BASE = 'http://127.0.0.1:3000/api';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const get = (p) => fetch(BASE + p).then((r) => r.json());

async function main() {
  // 0) 重置
  const reset = await post('/cassettes/reset', {});
  check('重置 200', reset.status === 200);

  // 1) 计划：小面额不足样例
  console.log('\n=== 计划：小面额不足 + 多组合 ===');
  const plan = await post('/plans/batch', {
    requests: [
      { clientRef: 'A1-86元', amountCents: 8600, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
      { clientRef: 'A2-27元', amountCents: 2700, allowedDenominations: [1000, 500], maxNotes: 50 },
      { clientRef: 'A3-32元', amountCents: 3200, allowedDenominations: [500, 200, 100], maxNotes: 50 },
    ],
  });
  const [a1, a2, a3] = plan.json.requests;
  check('A1 可行且 5 个组合', a1.planStatus === 'feasible' && a1.optionCount === 5);
  check(
    'A1 计划行金额合计正确（0 号组合 10 张 / 8600 分）',
    a1.options[0].totalNotes === 10 && a1.options[0].totalCents === 8600,
    `${a1.options[0].totalNotes}张`,
  );
  check('A2 不可行并说明缺 200 分', a2.planStatus === 'infeasible' && /200/.test(a2.reason));
  check('A3 全零钱可行', a3.planStatus === 'feasible');

  // 2) 批内竞争 + 事务回滚
  console.log('\n=== 竞争样例 + allOrNothing 事务回滚 ===');
  await post('/cassettes/reset', {});
  const planC = await post('/plans/batch', {
    requests: [
      { clientRef: 'C1-86元', amountCents: 8600, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
      { clientRef: 'C2-8元仅1元', amountCents: 800, allowedDenominations: [100], maxNotes: 50 },
    ],
  });
  const [c1, c2] = planC.json.requests;
  const rb = await post('/reserve/batch', {
    ids: [c1.id, c2.id],
    allOrNothing: true,
  });
  check('整批竞争失败返回 409', rb.status === 409, `HTTP ${rb.status}`);
  check('错误信息含库存不足', /仅剩 7 张/.test(JSON.stringify(rb.json)));
  const cassAfter = await get('/cassettes');
  check(
    '回滚后库存完整',
    cassAfter.find((c) => c.denomination === 100).remainingCount === 8 &&
      cassAfter.find((c) => c.denomination === 1000).remainingCount === 40,
  );

  // 3) 部分预占
  console.log('\n=== 非原子：C1 预占成功、C2 失败 ===');
  const pr = await post('/reserve/batch', { ids: [c1.id, c2.id], allOrNothing: false });
  check('部分预占 1 成功 1 失败', pr.json.reserved.length === 1 && pr.json.failed.length === 1);

  // 4) C1 成功出钞
  console.log('\n=== 模拟器三态 ===');
  const s1 = await post(`/requests/${c1.id}/dispense`, { outcome: 'success' });
  check('C1 足额出钞 dispensed', s1.json.request.reserveStatus === 'dispensed');
  check('C1 实际交付 8600', s1.json.request.deliveredCents === 8600);

  // E 组：拒钞 + 部分
  const planE = await post('/plans/batch', {
    requests: [
      { clientRef: 'E1-拒钞', amountCents: 8600, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
      { clientRef: 'E2-部分', amountCents: 5000, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
    ],
  });
  const [e1, e2] = planE.json.requests;
  await post('/reserve/batch', { ids: [e1.id, e2.id], allOrNothing: true });
  const rj = await post(`/requests/${e1.id}/dispense`, { outcome: 'reject' });
  check('E1 拒钞 failed 且交付 0', rj.json.request.reserveStatus === 'failed' && rj.json.request.deliveredCents === 0);
  const pt = await post(`/requests/${e2.id}/dispense`, {
    outcome: 'partial',
    delivered: { '1000': 3 },
  });
  check('E2 部分出钞 partial，交付 3000', pt.json.request.reserveStatus === 'partial' && pt.json.request.deliveredCents === 3000);

  // 非法：重复出钞
  const dup = await post(`/requests/${e2.id}/dispense`, { outcome: 'success' });
  check('终态再出钞 409', dup.status === 409);
  // 非法：部分出钞足额被拒绝（校验后不改变状态）
  const planF = await post('/plans/batch', {
    requests: [{ clientRef: 'F1', amountCents: 1000, allowedDenominations: [1000], maxNotes: 5 }],
  });
  const f1 = planF.json.requests[0];
  await post('/reserve/batch', { ids: [f1.id], allOrNothing: true });
  const bad = await post(`/requests/${f1.id}/dispense`, {
    outcome: 'partial',
    delivered: { '1000': 5 },
  });
  check('部分出钞足额被拒绝 400', bad.status === 400);
  // 该笔仍处于预占：成功再让它足额出钞，恢复账实平衡
  const fok = await post(`/requests/${f1.id}/dispense`, { outcome: 'success' });
  check('F1 随后足额出钞成功', fok.json.request.reserveStatus === 'dispensed');

  // 5) 核对
  console.log('\n=== 账实核对 ===');
  const rec = await get('/reconcile');
  check('核对 allPass', rec.allPass === true, rec.checks.filter((c) => !c.pass).map((c) => c.name).join('；'));
  check('实际已出 12600（C1 8600 + E2 3000 + F1 1000）', rec.summary.deliveredValueCents === 12600);
  check('预占未出 0', rec.summary.heldValueCents === 0);
  check(
    '全局价值守恒',
    rec.summary.initialValueCents ===
      rec.summary.remainingValueCents + rec.summary.heldValueCents + rec.summary.deliveredValueCents,
    `${rec.summary.initialValueCents} = ${rec.summary.remainingValueCents} + 0 + ${rec.summary.deliveredValueCents}`,
  );

  console.log(`\nHTTP 联调结果：${pass} 通过，${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
