import { Module } from '@nestjs/common';
import { DbService } from './db/db.service';
import { CashController } from './cash/cash.controller';
import { CashService } from './cash/cash.service';

@Module({
  imports: [],
  controllers: [CashController],
  providers: [DbService, CashService],
})
export class AppModule {}
