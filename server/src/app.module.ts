import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmOptions } from './db/typeorm.config';
import { CashModule } from './cash/cash.module';

@Module({
  imports: [TypeOrmModule.forRoot(typeOrmOptions()), CashModule],
})
export class AppModule {}
