import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  CashService,
  PlanBatchResponse,
  ReserveOutcome,
  WithdrawRequestDto,
} from './cash.service';

@Controller()
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly db: DbService,
  ) {}

  /** 钞箱库存（含可用/预占/已出钞/拒钞口径） */
  @Get('cassettes')
  cassettes() {
    return this.cash.getCassettes();
  }

  /** 单笔试算：返回可行组合或无解解释（不预占） */
  @Post('evaluate')
  evaluate(@Body() body: WithdrawRequestDto) {
    return this.cash.evaluate(body);
  }

  /** 为一批申请生成计划（纯计算，不写库） */
  @Post('plan')
  plan(@Body() body: { requests: WithdrawRequestDto[] }): Promise<PlanBatchResponse> {
    return this.cash.planBatch(body?.requests);
  }

  /** 在单个事务内整批预占；任何一笔不可行则整体回滚 */
  @Post('reserve')
  reserve(@Body() body: { requests: WithdrawRequestDto[] }): Promise<ReserveOutcome> {
    return this.cash.reserveBatch(body?.requests);
  }

  /** 模拟整批出钞并逐笔事务结算 */
  @Post('batches/:batchId/dispense')
  dispense(
    @Param('batchId') batchId: string,
    @Body()
    body: {
      mode?: 'simulate' | 'success' | 'reject' | 'shortage';
      rejectRate?: number;
      shortageRatio?: number;
      seed?: number;
    },
  ) {
    return this.cash.dispense(batchId, body ?? {});
  }

  /** 查询批次（计划/预占/实际结果） */
  @Get('batches/:batchId')
  getBatch(@Param('batchId') batchId: string) {
    return this.cash.getBatch(batchId);
  }

  /** 全量核对视图 */
  @Get('reconciliation')
  reconciliation() {
    return this.cash.reconciliation();
  }

  /** 重置演示数据（清空批次/预占，钞箱回到种子状态） */
  @Post('admin/reset')
  reset(
    @Body()
    body: { cassettes?: Array<{ denomination: number; stockTotal: number }> },
  ) {
    return this.db.reset(body?.cassettes);
  }
}
