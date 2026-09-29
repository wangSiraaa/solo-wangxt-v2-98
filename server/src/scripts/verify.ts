/* eslint-disable no-console */
/**
 * 端到端验证（真实 PostgreSQL，不连真实 ATM）：
 *  场景 A 小面额不足：一批 3 笔申请，含零钱不够 / 面额不允许 / 可行多组合
 *  场景 B 批内竞争：两笔可行申请，allOrNothing 事务回滚 vs 部分预占
 *  场景 C 出钞三态：成功足额 / 拒钞回补 / 部分未完成回补
 *  每步做库存守恒与账实核对；明确区分“计划成功 / 预占成功 / 现金实际交付”。
 */
import { DataSource } from 'typeorm';
import { ensurePostgres, DEFAULT_PG_CONFIG, stopPostgres } from '../db/pg-bootstrap';
import { typeOrmOptions } from '../db/typeorm.config';
import { CashService, DEFAULT_CASSETTES } from '../cash/cash.service';
import { PlannerService } from '../cash/planner.service';
import { Cassette } from '../cash/entities/cassette.entity';
import { CashRequest } from '../cash/entities/cash-request.entity';
import { CashLine } from '../cash/entities/cash-line.entity';
import { CashAudit } from '../cash/entities/cash-audit.entity';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  process.env.PG_DATA_DIR = process.env.PG_DATA_DIR ?? `${process.cwd()}/.pgdata-verify`;
  await ensurePostgres();
  const ds = new DataSource({ ...(typeOrmOptions() as any), synchronize: true });
  await ds.initialize();
  const cash = new CashService(ds, new PlannerService());

  console.log('\n=== 初始配钞（小面额偏紧）===');
  await cash.reset(DEFAULT_CASSETTES);
  const c0 = await cash.listCassettes();
  console.log(
    c0
      .map((c) => `${c.denomination}分×${c.remainingCount}`)
      .join('  '),
  );

  // ---------------------------------------------------------------- 场景 A
  console.log('\n=== 场景 A：一批申请生成计划（含小面额不足与多组合）===');
  const batch = await cash.planBatch({
    requests: [
      // A1 ¥86：有多个可行组合（1000x8+500+100 = 10 张为推荐）
      {
        clientRef: 'A1-86yuan-multi',
        amountCents: 8600,
        allowedDenominations: [1000, 500, 200, 100],
        maxNotes: 50,
      },
      // A2 ¥27 只允许大面额：粒度缺口
      {
        clientRef: 'A2-27yuan-gap',
        amountCents: 2700,
        allowedDenominations: [1000, 500],
        maxNotes: 50,
      },
      // A3 ¥32 只用零钱：恰好 200x12+100x8 = 3200 分，把全部小面额占满，独立计划可行
      {
        clientRef: 'A3-32yuan-small',
        amountCents: 3200,
        allowedDenominations: [500, 200, 100],
        maxNotes: 50,
      },
    ],
  });
  const [a1, a2, a3] = batch;
  check('A1 ¥86 计划可行（多组合）', a1.planStatus === 'feasible');
  check('A1 至少 2 个可行组合', a1.optionCount >= 2, `${a1.optionCount} 个组合`);
  check(
    'A1 推荐组合 = 1000x8+500x1+100x1（10 张）',
    JSON.stringify(a1.lines.filter((l) => l.optionIndex === 0).map((l) => [l.denomination, l.plannedCount])) ===
      JSON.stringify([[1000, 8], [500, 1], [100, 1]]),
  );
  check('A2 ¥27 计划不可行（面额缺口）', a2.planStatus === 'infeasible');
  check('A2 给出缺口解释', /还差 200 分/.test(a2.reason ?? ''), a2.reason ?? '');
  check('A3 ¥300 只用零钱计划可行', a3.planStatus === 'feasible');

  // 计划阶段库存分文不动
  const afterPlan = await cash.listCassettes();
  check(
    '计划阶段不扣减库存',
    afterPlan.every((c, i) => c.remainingCount === c0[i].remainingCount),
  );

  // ---------------------------------------------------------------- 场景 B
  console.log('\n=== 场景 B：事务预占，批内竞争 + allOrNothing 回滚 ===');
  // 先重置，再放两笔大零钱需求：200x12 + 100x8 = 3200 分
  // B1 ¥26（零钱）= 200x9+100x8 = 2600；B2 ¥10 仅 100 面额需 10 张但只有 8 张
  await cash.reset(DEFAULT_CASSETTES);
  const batchB = await cash.planBatch({
    requests: [
      { clientRef: 'B1-26yuan', amountCents: 2600, allowedDenominations: [200, 100], maxNotes: 50 },
      { clientRef: 'B2-10yuan-100only', amountCents: 1000, allowedDenominations: [100], maxNotes: 50 },
    ],
  });
  const [b1, b2] = batchB;
  check('B1 计划可行', b1.planStatus === 'feasible');
  check('B2 独立计划不可行：100 面额只有 8 张', b2.planStatus === 'infeasible', b2.reason ?? '');
  check(
    'B2 解释最多可凑 800 分、缺 200 分',
    /800/.test(b2.reason ?? '') && /200/.test(b2.reason ?? ''),
    b2.reason ?? '',
  );

  // 两笔同时可行但竞争同一库存的场景：
  // 重置：1000x40, 500x30, 200x12, 100x8
  // C1 ¥86 推荐组合占 100x1；C2 ¥99 只用零钱：
  //   9900 = 500x17+200x7 -> 17x500 库存 30 够, 200x7 够，且不需 100 —— 换设计。
  // 竞争设计：C1 选 0 号组合（1000x8+500+100），C2 同样要取 100x8（¥8，仅100面额）
  await cash.reset(DEFAULT_CASSETTES);
  const batchC = await cash.planBatch({
    requests: [
      { clientRef: 'C1-86yuan', amountCents: 8600, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
      { clientRef: 'C2-8yuan-100only', amountCents: 800, allowedDenominations: [100], maxNotes: 50 },
    ],
  });
  const [c1, c2] = batchC;
  check('C1/C2 各自计划都可行', c1.planStatus === 'feasible' && c2.planStatus === 'feasible');

  const stockBefore = await cash.listCassettes();
  // allOrNothing：C1 先预占（用掉唯一需要的 100x1），C2 还要 100x8，剩 7 张 -> 整批回滚
  let rollbackMsg = '';
  try {
    await cash.reserveBatch([c1.id, c2.id], { allOrNothing: true });
  } catch (e) {
    rollbackMsg = (e as Error).message;
  }
  check('allOrNothing 时第二笔失败导致整批中止', /回滚/.test(rollbackMsg), rollbackMsg);
  const stockAfterRollback = await cash.listCassettes();
  check(
    '回滚后库存完全不变（包括第一笔的扣减也撤销）',
    stockAfterRollback.every((c, i) => c.remainingCount === stockBefore[i].remainingCount),
    stockAfterRollback.map((c) => `${c.denomination}:${c.remainingCount}`).join(' '),
  );
  const statesAfterRollback = await cash.listRequests();
  check(
    '回滚后两笔仍是 none（不能把请求成功当成已预占/已交付）',
    statesAfterRollback.every((r) => r.reserveStatus === 'none'),
  );

  // 非 allOrNothing：C1 成功预占，C2 失败记录原因
  const partial = await cash.reserveBatch([c1.id, c2.id], { allOrNothing: false });
  check('部分预占：C1 成功', partial.reserved.length === 1);
  check(
    '部分预占：C2 失败并说明 100 面额剩 7 张',
    partial.failed.length === 1 && /仅剩 7 张/.test(partial.failed[0].reason),
    partial.failed[0]?.reason,
  );
  const stockPartial = await cash.listCassettes();
  const rem100 = stockPartial.find((x) => x.denomination === 100)!.remainingCount;
  check('C1 预占后 100 面额 8 -> 7', rem100 === 7, `剩 ${rem100}`);
  const rem1000 = stockPartial.find((x) => x.denomination === 1000)!.remainingCount;
  check('C1 预占后 1000 面额 40 -> 32', rem1000 === 32);

  // 核对：此刻应有 8600 分预占未出，已交付为 0
  const rec1 = await cash.reconcile();
  if (!rec1.allPass) {
    for (const c of rec1.checks.filter((x) => !x.pass)) {
      console.log(`  ↪ 失败项 ${c.name}：${c.detail}`);
    }
  }
  check('预占后核对全部通过', rec1.allPass);
  check('已交付仍为 0（预占 ≠ 交付）', rec1.summary.deliveredValueCents === 0);
  check('预占占用 8600 分', rec1.summary.heldValueCents === 8600);

  // ---------------------------------------------------------------- 场景 D
  console.log('\n=== 场景 D：模拟器出钞三态 ===');
  // C1 成功足额出钞
  const d1 = await cash.dispense(c1.id, 'success');
  check('C1 足额出钞：状态 dispensed', d1.reserveStatus === 'dispensed');
  check('C1 实际交付 8600 分', d1.deliveredCents === 8600, `实付 ${d1.deliveredCents}`);
  const stockD1 = await cash.listCassettes();
  // C1 预占 1000x8+500x1+100x1：remaining 1000=32,500=29,200=12,100=7
  check(
    'C1 出钞后：1000 remaining=32 且 delivered=8',
    stockD1.find((x) => x.denomination === 1000)!.remainingCount === 32 &&
      stockD1.find((x) => x.denomination === 1000)!.deliveredCount === 8,
  );
  check(
    'C1 出钞不重复扣 remaining（预占时已扣，500 仍为 29；delivered=1）',
    stockD1.find((x) => x.denomination === 500)!.remainingCount === 29 &&
      stockD1.find((x) => x.denomination === 500)!.deliveredCount === 1,
  );
  check('C1 出钞后 100 面额 delivered=1', stockD1.find((x) => x.denomination === 100)!.deliveredCount === 1);

  // 新一笔做拒钞：重置场景，预占后 reject，库存应原样回到初始
  await cash.reset(DEFAULT_CASSETTES);
  const batchE = await cash.planBatch({
    requests: [
      { clientRef: 'E1-reject', amountCents: 8600, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
      { clientRef: 'E2-partial', amountCents: 5000, allowedDenominations: [1000, 500, 200, 100], maxNotes: 50 },
    ],
  });
  const [e1, e2] = batchE;
  await cash.reserveBatch([e1.id, e2.id], { allOrNothing: true });
  const stockReserved = await cash.listCassettes();
  const rej = await cash.dispense(e1.id, 'reject');
  check('E1 拒钞：状态 failed', rej.reserveStatus === 'failed');
  check('E1 拒钞：交付 0 分（不能当成交付成功）', rej.deliveredCents === 0);
  const stockRej = await cash.listCassettes();
  // E1 预占：1000x8,500x1,100x1；E2 预占：1000x5
  // 两笔预占后：1000=27,500=29,100=7；E1 拒钞回补后：1000=35,500=30,100=8
  check(
    'E1 拒钞后其占用全部回补：1000=35, 500=30, 100=8（E2 的 1000x5 仍预占）',
    stockRej.find((x) => x.denomination === 1000)!.remainingCount === 35 &&
      stockRej.find((x) => x.denomination === 100)!.remainingCount === 8 &&
      stockRej.find((x) => x.denomination === 500)!.remainingCount === 30,
    stockRej.map((c) => `${c.denomination}:${c.remainingCount}`).join(' '),
  );
  check('E1 拒钞后 delivered 计数仍为 0', stockRej.every((c) => c.deliveredCount === 0));

  // E2 部分出钞：预占 1000x5；模拟 ATM 只吐了 1000x3，2 张未完成
  const part = await cash.dispense(e2.id, 'partial', { '1000': 3 });
  check('E2 部分出钞：状态 partial', part.reserveStatus === 'partial');
  check('E2 部分出钞：实际交付 3000 分，非 5000', part.deliveredCents === 3000);
  const stockPart = await cash.listCassettes();
  check(
    'E2 未完成 2 张 1000 回补：1000 剩 35+2=37；delivered 1000 = 3',
    stockPart.find((x) => x.denomination === 1000)!.remainingCount === 37 &&
      stockPart.find((x) => x.denomination === 1000)!.deliveredCount === 3,
    `剩 ${stockPart.find((x) => x.denomination === 1000)!.remainingCount}`,
  );

  // 非法 partial：交付张数超过预占
  let badPartial = '';
  try {
    await cash.dispense(e2.id, 'partial', { '1000': 99 });
  } catch (e) {
    badPartial = (e as Error).message;
  }
  check('终态申请不能再次出钞', /已预占/.test(badPartial), badPartial);

  // 全部核对
  const recFinal = await cash.reconcile();
  console.log('\n=== 最终核对明细 ===');
  for (const c of recFinal.checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}：${c.detail}`);
  }
  check('最终核对全部通过', recFinal.allPass);
  check(
    '全局价值守恒：初始价值 = 现存 + 预占 + 已出',
    recFinal.summary.initialValueCents ===
      recFinal.summary.remainingValueCents +
        recFinal.summary.heldValueCents +
        recFinal.summary.deliveredValueCents,
    `${recFinal.summary.initialValueCents} = ${recFinal.summary.remainingValueCents} + ${recFinal.summary.heldValueCents} + ${recFinal.summary.deliveredValueCents}`,
  );
  check('已交付 = 3000 分（仅 E2 的 3 张 1000）', recFinal.summary.deliveredValueCents === 3000);
  check('预占占用 = 0（无 reserved 申请遗留）', recFinal.summary.heldValueCents === 0);

  await ds.destroy();
  await stopPostgres();

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
