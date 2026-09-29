import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 钞箱：一种面额一行。
 * stock_total       钞箱当前总张数（含可用、预占、已出钞、拒钞后不在可用口径内单独追踪）
 * stock_reserved    已被预占但尚未出钞结算的张数
 * stock_delivered   已确认出钞交付给客户的张数（累计，仅用于展示/核对，可在补钞时重置）
 * stock_rejected    模拟器判定拒钞、进入回收/拒钞箱的张数（累计）
 *
 * 口径不变式（每个面额）：
 *   available = stock_total - stock_reserved - stock_delivered - stock_rejected >= 0
 * 预占只增加 stock_reserved；结算时把预占转为 delivered/rejected 或释放回可用。
 */
@Entity('cassettes')
export class CassetteEntity {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Index({ unique: true })
  @Column({ type: 'integer' })
  denomination: number;

  @Column({ type: 'integer', name: 'stock_total' })
  stockTotal: number;

  @Column({ type: 'integer', name: 'stock_reserved', default: 0 })
  stockReserved: number;

  @Column({ type: 'integer', name: 'stock_delivered', default: 0 })
  stockDelivered: number;

  @Column({ type: 'integer', name: 'stock_rejected', default: 0 })
  stockRejected: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type ReservationStatus =
  | 'RESERVED' // 已预占，等待模拟出钞
  | 'DISPENSED' // 全部出钞成功
  | 'PARTIAL' // 部分交付（有拒钞或未完成数量）
  | 'FAILED'; // 全部未交付，预占已释放回可用库存

@Entity('reservations')
export class ReservationEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ type: 'bigint', name: 'batch_id' })
  batchId: string;

  @Column({ type: 'integer' })
  seq: number;

  /** 客户申请的取款金额（元，正整数） */
  @Column({ type: 'integer', name: 'requested_amount' })
  requestedAmount: number;

  /** 该笔允许的面额（元，升序） */
  @Column({ type: 'integer', name: 'allowed_denominations', array: true })
  allowedDenominations: number[];

  @Column({ type: 'integer', name: 'max_notes' })
  maxNotes: number;

  /**
   * 计划组合快照：{ 面额: 张数 }（配钞算法给出的主组合，也是预占的组合）。
   * 计划成功不等于现金交付——现金以 stock_delivered / 状态 DISPENSED 为准。
   */
  @Column({ type: 'jsonb', name: 'plan_counts' })
  planCounts: Record<string, number>;

  @Column({ type: 'integer', name: 'plan_notes' })
  planNotes: number;

  /** 实际成功出钞的组合 { 面额: 张数 } */
  @Column({ type: 'jsonb', name: 'delivered_counts', default: {} })
  deliveredCounts: Record<string, number>;

  /** 拒钞（回收箱）的组合 { 面额: 张数 } */
  @Column({ type: 'jsonb', name: 'rejected_counts', default: {} })
  rejectedCounts: Record<string, number>;

  /** 未完成（既未出钞也未拒钞，预占被释放回可用库存）的组合 { 面额: 张数 } */
  @Column({ type: 'jsonb', name: 'unfinished_counts', default: {} })
  unfinishedCounts: Record<string, number>;

  @Column({ type: 'integer', name: 'delivered_amount', default: 0 })
  deliveredAmount: number;

  @Column({ type: 'integer', name: 'rejected_amount', default: 0 })
  rejectedAmount: number;

  @Column({ type: 'integer', name: 'unfinished_amount', default: 0 })
  unfinishedAmount: number;

  @Column({ type: 'integer', name: 'delivered_notes', default: 0 })
  deliveredNotes: number;

  /** 单笔模拟拒钞概率（0..1），仅用于审计展示 */
  @Column({ type: 'double precision', name: 'reject_rate', default: 0 })
  rejectRate: number;

  @Column({ type: 'varchar', length: 16, default: 'RESERVED' })
  status: ReservationStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/**
 * 批次：一批取款申请共享一个 batch_id。
 * 计划生成是纯计算（不落库）；预占在单个数据库事务内整批原子完成。
 */
@Entity('batches')
export class BatchEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** PLANNED -> RESERVED -> SETTLED；预占事务失败则不落批、整体回滚 */
  @Column({ type: 'varchar', length: 16, default: 'PLANNED' })
  status: 'PLANNED' | 'RESERVED' | 'SETTLED';

  @Column({ type: 'integer' })
  total: number;

  @Column({ type: 'integer', name: 'feasible_count', default: 0 })
  feasibleCount: number;

  @Column({ type: 'integer', name: 'reserved_count', default: 0 })
  reservedCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
