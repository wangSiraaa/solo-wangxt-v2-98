import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Param,
} from '@nestjs/common';
import { CashService, DEFAULT_CASSETTES } from './cash.service';
import { BadInput, PlanBatchDto } from './dto';

function mapError(e: unknown): never {
  if (e instanceof BadInput) throw new BadRequestException(e.message);
  if (e instanceof Error && e.name === 'ConflictError') {
    const ce = e as Error & { details?: unknown };
    throw new ConflictException({ message: ce.message, details: ce.details });
  }
  throw e;
}

@Controller()
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('cassettes')
  cassettes() {
    return this.cash.listCassettes();
  }

  @Get('requests')
  requests() {
    return this.cash.listRequests();
  }

  @Get('reconcile')
  reconcile() {
    return this.cash.reconcile();
  }

  @Post('cassettes/reset')
  @HttpCode(200)
  async reset(@Body() body: { cassettes?: { denomination: number; count: number }[] }) {
    try {
      await this.cash.reset(body?.cassettes ?? DEFAULT_CASSETTES);
      return { ok: true, cassettes: await this.cash.listCassettes() };
    } catch (e) {
      mapError(e);
    }
  }

  /** 第一步：一批申请生成计划（不碰库存） */
  @Post('plans/batch')
  @HttpCode(200)
  async planBatch(@Body() body: PlanBatchDto) {
    try {
      const requests = await this.cash.planBatch(body ?? { requests: [] });
      return { requests: serializeRequests(requests) };
    } catch (e) {
      mapError(e);
    }
  }

  /** 第二步：事务预占。body: { ids, allOrNothing, optionByRequest } */
  @Post('reserve/batch')
  @HttpCode(200)
  async reserveBatch(
    @Body() body: {
      ids?: string[];
      allOrNothing?: boolean;
      optionByRequest?: Record<string, number>;
    },
  ) {
    try {
      const result = await this.cash.reserveBatch(body?.ids ?? [], {
        allOrNothing: body?.allOrNothing,
        optionByRequest: body?.optionByRequest,
      });
      return result;
    } catch (e) {
      mapError(e);
    }
  }

  /** 第三步：模拟器出钞回报 */
  @Post('requests/:id/dispense')
  @HttpCode(200)
  async dispense(
    @Param('id') id: string,
    @Body()
    body: { outcome: 'success' | 'reject' | 'partial'; delivered?: Record<string, number> },
  ) {
    try {
      const req = await this.cash.dispense(id, body?.outcome, body?.delivered);
      return { request: serializeRequests([req])[0] };
    } catch (e) {
      mapError(e);
    }
  }
}

/** 序列化为前端友好结构：snake_case 实体 → camelCase + 组合分组 */
export function serializeRequests(requests: any[]) {
  return requests.map((r: any) => {
    const options: any[] = [];
    for (const line of r.lines ?? []) {
      let opt = options[line.optionIndex];
      if (!opt) {
        opt = { optionIndex: line.optionIndex, lines: [], totalNotes: 0, totalCents: 0 };
        options[line.optionIndex] = opt;
      }
      opt.lines.push({
        denomination: line.denomination,
        plannedCount: line.plannedCount,
        reservedCount: line.reservedCount,
        deliveredCount: line.deliveredCount,
        picked: line.picked,
      });
      // 计划阶段即展示组合自身的张数/金额（来自计划行，与是否选中无关）
      opt.totalNotes += line.plannedCount;
      opt.totalCents += line.denomination * line.plannedCount;
    }
    return {
      id: r.id,
      clientRef: r.clientRef,
      amountCents: r.amount,
      allowedDenominations: r.allowedDenominations,
      maxNotes: r.maxNotes,
      planStatus: r.planStatus,
      reason: r.reason,
      optionCount: r.optionCount,
      reserveStatus: r.reserveStatus,
      reservedCents: r.reservedCents,
      deliveredCents: r.deliveredCents,
      deliveredNotes: r.deliveredNotes,
      options: options.filter(Boolean),
    };
  });
}
