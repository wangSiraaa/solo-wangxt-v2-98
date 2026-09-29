import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cassette } from './entities/cassette.entity';
import { CashRequest } from './entities/cash-request.entity';
import { CashLine } from './entities/cash-line.entity';
import { CashAudit } from './entities/cash-audit.entity';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { PlannerService } from './planner.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cassette, CashRequest, CashLine, CashAudit])],
  controllers: [CashController],
  providers: [CashService, PlannerService],
  exports: [CashService, PlannerService],
})
export class CashModule {}
