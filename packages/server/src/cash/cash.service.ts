import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DbService } from '../db/db.service';
import {
  BatchEntity,
  CassetteEntity,
  ReservationEntity,
  ReservationStatus,
} from '../db/entities';
import { solveBounded, SolveResult } from '../solver/bounded-solver';

export interface WithdrawRequestDto {
  amount: number;
  allowedDenominations?: number[];
  maxNotes: number;
}

export interface PlanItemView {
  seq: number;
  request: WithdrawRequestDto;
  result: SolveResult;
}

export interface PlanBatchResponse {
  total: number;
  feasibleCount: number;
  items: PlanItemView[];
}

export interface ReserveOutcome {
  batchId: string;
  status: 'RESERVED' | 'ROLLED_BACK';
  reservedCount: number;
  /** 整批预占事务失败时的原因（任何一笔库存被并发扣穿等），此时无任何预占落库 */
  error?: string;
  /** 导致整批回滚的那一笔（seq 从 0 开始） */
  failedAtSeq?: number;
  reservations?: Array<{
    id: string;
    seq: number;
    requestedAmount: number;
    planCounts: Record<string, number>;
    planNotes: number;
    status: ReservationStatus;
  }>;
}

@Injectable()
export class CashService {
  constructor(private readonly db: DbService) {}

  /** 读取钞箱（库存视图，按面额升序） */
  async getCassettes(): Promise<
    Array<{
      id: number;
      denomination: number;
      stockTotal: number;
      stockReserved: number;
      stockDelivered: number;
      stockRejected: number;
      stockAvailable: number;
    }>
  > {
    const rows = await this.db.dataSource.getRepository(CassetteEntity).find({
      order: { denomination: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      denomination: r.denomination,
      stockTotal: r.stockTotal,
      stockReserved: r.stockReserved,
      stockDelivered: r.stockDelivered,
      stockRejected: r.stockRejected,
      stockAvailable:
        r.stockTotal - r.stockReserved - r.stockDelivered - r.stockRejected,
    }));
  }

  /** 单笔试算（不碰数据库写操作；库存来自 DB 的当前可用量） */
  async evaluate(req: WithdrawRequestDto): Promise<SolveResult> {
    this.validateRequest(req);
    const denoms = await this.snapshotAvailableDenoms();
    return solveBounded({
      amount: req.amount,
      allowedDenominations: req.allowedDenominations,
      maxNotes: req.maxNotes,
      denoms,
    });
  }

  /**
   * 为一批申请生成计划：纯计算，不写库、不预占。
   * 每笔独立给出可行组合或无解解释。
   */
  async planBatch(requests: WithdrawRequestDto[]): Promise<PlanBatchResponse> {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new BadRequestException('批次至少包含一笔取款申请');
    }
    requests.forEach((r, i) => this.validateRequest(r, i));
    const denoms = await this.snapshotAvailableDenoms();

    const items: PlanItemView[] = requests.map((request, seq) => ({
      seq,
      request,
      result: solveBounded({
        amount: request.amount,
        allowedDenominations: request.allowedDenominations,
        maxNotes: request.maxNotes,
        denoms,
      }),
    }));
    return {
      total: items.length,
      feasibleCount: items.filter((i) => i.result.feasible).length,
      items,
    };
  }

  /**
   * 在单个数据库事务内为整批申请预占库存。
   *  - 重新计算计划（不信前端结果）；
   *  - 按面额升序 SELECT ... FOR UPDATE 锁所有钞箱行（固定加锁顺序防死锁）；
   *  - 累计本批需求并逐面额校验可用余量；任何一笔/任一面额不足则抛错，
   *    事务整体回滚：批次、预占、库存改动全部不发生；
   *  - 全部通过才插入批次+预占行并提交。
   */
  async reserveBatch(
    requests: WithdrawRequestDto[],
  ): Promise<ReserveOutcome> {
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new BadRequestException('批次至少包含一笔取款申请');
    }
    requests.forEach((r, i) => this.validateRequest(r, i));

    const ds = this.db.dataSource;
    try {
      const result = await ds.transaction(async (em: EntityManager) => {
        // 1) 固定顺序对全部钞箱行加行锁（FOR UPDATE），强制并发批次串行化，防死锁。
        //    必须走原生查询：TypeORM 身份映射可能返回未反映锁等待后最新值的陈旧实体。
        const lockedRows: Array<{
          id: number;
          denomination: number;
          stock_total: number;
          stock_reserved: number;
          stock_delivered: number;
          stock_rejected: number;
        }> = await em.query(
          `SELECT id, denomination, stock_total, stock_reserved,
                  stock_delivered, stock_rejected
             FROM cassettes ORDER BY denomination ASC FOR UPDATE`,
        );
        const casById = new Map(lockedRows.map((r) => [r.id, r]));
        const casByDenom = new Map(lockedRows.map((r) => [r.denomination, r]));

        // 2) 本批对每个面额的累计需求
        const aggregate = new Map<number, number>();
        const plans: Array<{
          seq: number;
          req: WithdrawRequestDto;
          counts: Record<number, number>;
          notes: number;
        }> = [];

        for (let seq = 0; seq < requests.length; seq++) {
          const req = requests[seq];
          const denoms = lockedRows.map((r) => ({
            denomination: r.denomination,
            stock:
              r.stock_total -
              r.stock_reserved -
              r.stock_delivered -
              r.stock_rejected -
              (aggregate.get(r.denomination) ?? 0),
          }));
          const res = solveBounded({
            amount: req.amount,
            allowedDenominations: req.allowedDenominations,
            maxNotes: req.maxNotes,
            denoms,
          });
          if (!res.feasible) {
            const err = new Error(
              `SEQ_${seq}_INFEASIBLE: ${res.reasonCode}: ${res.message}`,
            );
            (err as Error & { failedSeq: number }).failedSeq = seq;
            throw err;
          }
          const counts: Record<number, number> = {};
          let notes = 0;
          for (const [dStr, q] of Object.entries(res.primary.counts)) {
            const d = Number(dStr);
            counts[d] = q;
            notes += q;
            aggregate.set(d, (aggregate.get(d) ?? 0) + q);
          }
          plans.push({ seq, req, counts, notes });
        }

        // 3) 逐面额执行“带余量条件的原子增量更新”。
        //    即使并发事务在锁外绕过，CHECK/WHERE 也会使更新 0 行 → 抛错回滚，绝不超卖。
        for (const [d, q] of aggregate) {
          const cas = casByDenom.get(d);
          if (!cas) throw new Error(`缺少面额 ${d} 的钞箱`);
          // 注意：TypeORM 的 query() 对 UPDATE 返回 [rows, rowCount] 元组
          // （SELECT 才直接返回 rows），这里用 rowCount 判断条件更新是否命中。
          const [, updRowCount]: [Array<{ id: number }>, number] =
            await em.query(
              `UPDATE cassettes
                  SET stock_reserved = stock_reserved + $2,
                      updated_at = now()
                WHERE id = $1
                  AND stock_total - stock_reserved - stock_delivered - stock_rejected >= $2
               RETURNING id`,
              [cas.id, q],
            );
          if (updRowCount !== 1) {
            const err = new Error(
              `DENOM_${d}_SHORTAGE: 面额 ${d} 可用余量不足 ${q} 张（并发扣穿或库存变化），整批回滚`,
            );
            (err as Error & { failedSeq: number }).failedSeq = plans.length;
            throw err;
          }
        }

        // 4) 写入批次与逐笔预占（计划快照）。注意：这只是“预占”，现金尚未交付。
        const batch = new BatchEntity();
        batch.total = requests.length;
        batch.feasibleCount = plans.length;
        batch.reservedCount = plans.length;
        batch.status = 'RESERVED';
        const savedBatch = await em.save(batch);

        const reservationViews: NonNullable<ReserveOutcome['reservations']> = [];
        for (const p of plans) {
          const row = new ReservationEntity();
          row.batchId = savedBatch.id;
          row.seq = p.seq;
          row.requestedAmount = p.req.amount;
          row.allowedDenominations = (
            p.req.allowedDenominations &&
            p.req.allowedDenominations.length > 0
              ? [...p.req.allowedDenominations]
              : lockedRows.map((r) => r.denomination)
          ).sort((a, b) => a - b);
          row.maxNotes = p.req.maxNotes;
          row.planCounts = Object.fromEntries(
            Object.entries(p.counts).map(([d, q]) => [String(d), q]),
          );
          row.planNotes = p.notes;
          row.status = 'RESERVED';
          const saved = await em.save(row);
          reservationViews.push({
            id: String(saved.id),
            seq: saved.seq,
            requestedAmount: saved.requestedAmount,
            planCounts: saved.planCounts,
            planNotes: saved.planNotes,
            status: saved.status,
          });
        }

        return { batchId: String(savedBatch.id), reservationViews };
      });

      return {
        batchId: result.batchId,
        status: 'RESERVED',
        reservedCount: requests.length,
        reservations: result.reservationViews,
      };
    } catch (e) {
      const err = e as Error & { failedSeq?: number };
      return {
        batchId: '',
        status: 'ROLLED_BACK',
        reservedCount: 0,
        failedAtSeq: typeof err.failedSeq === 'number' ? err.failedSeq : undefined,
        error: err.message,
      };
    }
  }

  /**
   * 模拟出钞并在逐笔事务内结算。
   *
   * 对每笔预占，逐张决定成功/拒钞（确定性伪随机，种子 = 预占 id + 张序号），
   * 拒钞进入拒钞箱；张数不足时剩余张数标记为“未完成”。
   * 现金交付只以 deliveredCounts 为准——请求成功/已预占都不代表现金已交付。
   *
   * mode:
   *  - simulate 按 rejectRate 逐张模拟
   *  - success  全部成功
   *  - reject   全部拒钞
   *  - shortage 按 shortageRatio 随机砍掉一部分张数作为“未完成”
   */
  async dispense(
    batchId: string,
    options: {
      mode?: 'simulate' | 'success' | 'reject' | 'shortage';
      rejectRate?: number;
      shortageRatio?: number;
      seed?: number;
    } = {},
  ): Promise<{
    batchId: string;
    mode: string;
    results: Array<{
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
    }>;
  }> {
    const mode = options.mode ?? 'simulate';
    const rejectRate =
      typeof options.rejectRate === 'number' ? options.rejectRate : 0.05;
    const shortageRatio =
      typeof options.shortageRatio === 'number' ? options.shortageRatio : 0.2;

    const ds = this.db.dataSource;
    const reservations = await ds.getRepository(ReservationEntity).find({
      where: { batchId: batchId },
      order: { seq: 'ASC' },
    });
    if (reservations.length === 0) {
      throw new BadRequestException(`批次 ${batchId} 不存在或没有预占记录`);
    }

    const results = [];
    for (const r of reservations) {
      const settled = await ds.transaction(async (em: EntityManager) => {
        // 行锁预占记录（原生查询，避免身份映射陈旧实体）
        const lockedRows = await em.query(
          `SELECT * FROM reservations WHERE id = $1 FOR UPDATE`,
          [r.id],
        );
        if (lockedRows.length === 0) throw new Error('预占记录消失');
        const lockedRow = lockedRows[0] as {
          id: string;
          batch_id: string;
          seq: number;
          requested_amount: number;
          allowed_denominations: number[];
          max_notes: number;
          plan_counts: Record<string, number>;
          plan_notes: number;
          status: ReservationStatus;
          note: string | null;
        };
        if (lockedRow.status !== 'RESERVED') {
          // 幂等：已结算的直接回传既有结果（从仓储读取实体形态）
          return em.findOneByOrFail(ReservationEntity, {
            id: String(lockedRow.id),
          });
        }
        const planCounts = lockedRow.plan_counts;

        // 锁对应钞箱行（固定面额顺序，原生行锁取最新值）
        const denomsUsed = Object.keys(planCounts).map((s) => Number(s));
        const cassRows: Array<{
          id: number;
          denomination: number;
          stock_total: number;
          stock_reserved: number;
          stock_delivered: number;
          stock_rejected: number;
        }> = denomsUsed.length
          ? await em.query(
              `SELECT id, denomination, stock_total, stock_reserved,
                      stock_delivered, stock_rejected
                 FROM cassettes WHERE denomination = ANY($1)
                 ORDER BY denomination ASC FOR UPDATE`,
              [denomsUsed],
            )
          : [];
        const casByDenom = new Map(cassRows.map((c) => [Number(c.denomination), c]));

        // 确定性伪随机（mulberry32），避免“每次刷新结果不同”
        const seedBase =
          (options.seed ?? 20260928) + Number(lockedRow.id) * 7919;
        let seed = seedBase >>> 0;
        const rand = (): number => {
          seed |= 0;
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };

        const delivered: Record<string, number> = {};
        const rejected: Record<string, number> = {};
        const unfinished: Record<string, number> = {};
        let dAmount = 0;
        let rAmount = 0;
        let uAmount = 0;
        let dNotes = 0;
        let rNotes = 0;
        let uNotes = 0;
        let planNotes = 0;

        for (const [dStr, planned0] of Object.entries(planCounts)) {
          const planned = Number(planned0);
          const d = Number(dStr);
          const cas = casByDenom.get(d);
          if (!cas) throw new Error(`缺少面额 ${d} 钞箱`);
          // 钞箱机械未完成张数（吐钞通道故障/钞箱抽空）：不产生拒钞，预占释放
          let mechanicalShort = 0;
          if (mode === 'shortage') {
            mechanicalShort = Math.round(planned * shortageRatio);
          }
          let ok = 0;
          let rej = 0;
          for (let i = 0; i < planned - mechanicalShort; i++) {
            if (mode === 'success') {
              ok++;
            } else if (mode === 'reject') {
              rej++;
            } else if (mode === 'shortage') {
              ok++;
            } else {
              // simulate：按拒钞率逐张判定
              if (rand() < rejectRate) rej++;
              else ok++;
            }
          }
          if (ok > 0) {
            delivered[dStr] = ok;
            dAmount += ok * d;
            dNotes += ok;
          }
          if (rej > 0) {
            rejected[dStr] = rej;
            rAmount += rej * d;
            rNotes += rej;
          }
          if (mechanicalShort > 0) {
            unfinished[dStr] = mechanicalShort;
            uAmount += mechanicalShort * d;
            uNotes += mechanicalShort;
          }

          // 钞箱结算（原子增减，WHERE 保证 reserved 够减、口径不变式不被破坏）：
          //   reserved -= planned（含拒钞与未完成：拒钞转回收箱、未完成退回可用）
          //   delivered += ok；rejected += rej
          const [, settleRowCount]: [Array<{ id: number }>, number] =
            await em.query(
            `UPDATE cassettes
                SET stock_reserved  = stock_reserved  - $2,
                    stock_delivered = stock_delivered + $3,
                    stock_rejected  = stock_rejected  + $4,
                    updated_at = now()
              WHERE id = $1
                AND stock_reserved >= $2
                AND stock_total - (stock_reserved - $2)
                              - (stock_delivered + $3)
                              - (stock_rejected + $4) >= 0
             RETURNING id`,
            [cas.id, planned, ok, rej],
          );
          if (settleRowCount !== 1) {
            throw new Error(
              `SETTLE_DENOM_${d}_BROKEN: 面额 ${d} 结算被库存口径约束拒绝（reserved=${cas.stock_reserved}, plan=${planned}）`,
            );
          }
          planNotes += planned;
        }

        const allDelivered =
          dNotes === planNotes && rNotes === 0 && uNotes === 0;
        const noneDelivered = dNotes === 0;
        const status: ReservationStatus = allDelivered
          ? 'DISPENSED'
          : noneDelivered
            ? 'FAILED'
            : 'PARTIAL';
        const parts: string[] = [];
        parts.push(`计划 ${lockedRow.requested_amount} 元 / ${planNotes} 张`);
        parts.push(`实际交付 ${dAmount} 元 / ${dNotes} 张`);
        if (rNotes > 0) parts.push(`拒钞 ${rAmount} 元 / ${rNotes} 张（入回收箱）`);
        if (uNotes > 0) parts.push(`未完成 ${uAmount} 元 / ${uNotes} 张（预占释放）`);
        const note = parts.join('；');

        // 回写预占行（原生 UPDATE，行锁保护）
        await em.query(
          `UPDATE reservations SET
             delivered_counts = $2::jsonb,
             rejected_counts  = $3::jsonb,
             unfinished_counts= $4::jsonb,
             delivered_amount = $5,
             rejected_amount  = $6,
             unfinished_amount= $7,
             delivered_notes  = $8,
             reject_rate      = $9,
             status           = $10,
             note             = $11,
             updated_at       = now()
           WHERE id = $1`,
          [
            lockedRow.id,
            JSON.stringify(delivered),
            JSON.stringify(rejected),
            JSON.stringify(unfinished),
            dAmount,
            rAmount,
            uAmount,
            dNotes,
            mode === 'simulate' ? rejectRate : 0,
            status,
            note,
          ],
        );
        return em.findOneByOrFail(ReservationEntity, {
          id: String(lockedRow.id),
        });
      });

      results.push({
        reservationId: String(settled.id),
        seq: settled.seq,
        requestedAmount: settled.requestedAmount,
        status: settled.status,
        planCounts: settled.planCounts,
        deliveredCounts: settled.deliveredCounts,
        rejectedCounts: settled.rejectedCounts,
        unfinishedCounts: settled.unfinishedCounts,
        deliveredAmount: settled.deliveredAmount,
        rejectedAmount: settled.rejectedAmount,
        unfinishedAmount: settled.unfinishedAmount,
        note: settled.note,
      });
    }

    // 批次状态 -> SETTLED
    await ds.getRepository(BatchEntity).update(
      { id: batchId },
      { status: 'SETTLED' },
    );

    return { batchId, mode, results };
  }

  async getBatch(batchId: string): Promise<{
    batch: BatchEntity;
    reservations: ReservationEntity[];
  }> {
    const batch = await this.db.dataSource
      .getRepository(BatchEntity)
      .findOneByOrFail({ id: batchId });
    const reservations = await this.db.dataSource
      .getRepository(ReservationEntity)
      .find({ where: { batchId }, order: { seq: 'ASC' } });
    return { batch, reservations };
  }

  /** 全量核对视图：钞箱口径 + 按批次的计划/预占/实际汇总 */
  async reconciliation(): Promise<{
    cassettes: Array<Record<string, number | string>>;
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
    invariantCheck: {
      ok: boolean;
      violations: string[];
    };
  }> {
    const rows = await this.db.dataSource.getRepository(CassetteEntity).find({
      order: { denomination: 'ASC' },
    });
    const reservations = await this.db.dataSource
      .getRepository(ReservationEntity)
      .find({ order: { id: 'ASC' } });

    const totals = {
      stockTotalValue: 0,
      reservedValue: 0,
      deliveredValue: 0,
      rejectedValue: 0,
      availableValue: 0,
      stockTotalNotes: 0,
      reservedNotes: 0,
      deliveredNotes: 0,
      rejectedNotes: 0,
      availableNotes: 0,
    };
    const violations: string[] = [];
    const cassettes = rows.map((r) => {
      const available =
        r.stockTotal - r.stockReserved - r.stockDelivered - r.stockRejected;
      if (available < 0) {
        violations.push(
          `面额 ${r.denomination}：可用张数为负 (${available})，口径不变式被破坏`,
        );
      }
      totals.stockTotalValue += r.stockTotal * r.denomination;
      totals.reservedValue += r.stockReserved * r.denomination;
      totals.deliveredValue += r.stockDelivered * r.denomination;
      totals.rejectedValue += r.stockRejected * r.denomination;
      totals.availableValue += available * r.denomination;
      totals.stockTotalNotes += r.stockTotal;
      totals.reservedNotes += r.stockReserved;
      totals.deliveredNotes += r.stockDelivered;
      totals.rejectedNotes += r.stockRejected;
      totals.availableNotes += available;
      return {
        denomination: r.denomination,
        stockTotal: r.stockTotal,
        stockReserved: r.stockReserved,
        stockDelivered: r.stockDelivered,
        stockRejected: r.stockRejected,
        stockAvailable: available,
      };
    });

    // 交叉核对：每笔 RESERVED 预占必须等于钞箱上的 reserved 汇总
    const reservedByDenom = new Map<number, number>();
    for (const rv of reservations) {
      if (rv.status === 'RESERVED') {
        for (const [dStr, q] of Object.entries(rv.planCounts)) {
          const d = Number(dStr);
          reservedByDenom.set(d, (reservedByDenom.get(d) ?? 0) + q);
        }
      }
    }
    for (const r of rows) {
      const expectReserved = reservedByDenom.get(r.denomination) ?? 0;
      if (expectReserved !== r.stockReserved) {
        violations.push(
          `面额 ${r.denomination}：钞箱预占 ${r.stockReserved} 张与未结算预占汇总 ${expectReserved} 张不一致`,
        );
      }
    }

    return {
      cassettes,
      totals,
      reservations: reservations.map((rv) => ({
        id: String(rv.id),
        batchId: String(rv.batchId),
        seq: rv.seq,
        requestedAmount: rv.requestedAmount,
        status: rv.status,
        planAmount: rv.requestedAmount,
        deliveredAmount: rv.deliveredAmount,
        rejectedAmount: rv.rejectedAmount,
        unfinishedAmount: rv.unfinishedAmount,
        note: rv.note,
      })),
      invariantCheck: { ok: violations.length === 0, violations },
    };
  }

  private async snapshotAvailableDenoms(): Promise<
    Array<{ denomination: number; stock: number }>
  > {
    const rows = await this.db.dataSource.getRepository(CassetteEntity).find({
      order: { denomination: 'ASC' },
    });
    return rows.map((r) => ({
      denomination: r.denomination,
      stock:
        r.stockTotal - r.stockReserved - r.stockDelivered - r.stockRejected,
    }));
  }

  private validateRequest(req: WithdrawRequestDto, seq?: number): void {
    const where =
      typeof seq === 'number' ? `（第 ${seq + 1} 笔）` : '';
    if (
      !req ||
      !Number.isInteger(req.amount) ||
      req.amount <= 0 ||
      req.amount > 1_000_000
    ) {
      throw new BadRequestException(`取款金额必须为 1..1000000 的正整数${where}`);
    }
    if (!Number.isInteger(req.maxNotes) || req.maxNotes <= 0 || req.maxNotes > 200) {
      throw new BadRequestException(`单笔张数上限必须为 1..200 的正整数${where}`);
    }
    if (req.allowedDenominations !== undefined) {
      if (
        !Array.isArray(req.allowedDenominations) ||
        req.allowedDenominations.some((d) => !Number.isInteger(d) || d <= 0)
      ) {
        throw new BadRequestException(`允许面额必须为正整数数组${where}`);
      }
    }
  }
}
