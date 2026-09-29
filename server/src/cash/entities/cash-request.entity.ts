import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CashLine } from './cash-line.entity';

export type PlanRequestStatus = 'feasible' | 'infeasible';
export type ReserveStatus = 'reserved' | 'dispensed' | 'partial' | 'failed';

/** 一笔模拟取款申请 */
@Entity('cash_request')
export class CashRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 调用方提供的业务编号（同一批内唯一），便于人读对账 */
  @Column({ type: 'varchar', length: 64, name: 'client_ref' })
  clientRef!: string;

  /** 取款金额，整数分 */
  @Column({ type: 'int' })
  amount!: number;

  /** 允许面额，整数分数组 */
  @Column({ type: 'int', array: true, name: 'allowed_denominations' })
  allowedDenominations!: number[];

  /** 单笔张数上限 */
  @Column({ type: 'int', name: 'max_notes' })
  maxNotes!: number;

  @Column({ type: 'varchar', length: 16, default: 'feasible' })
  planStatus!: PlanRequestStatus;

  /** 不可行时的人话解释 */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /** 枚举到的可行组合数量（上限 5） */
  @Column({ type: 'int', default: 0, name: 'option_count' })
  optionCount!: number;

  /** 无预占；reserved=已预占未出钞；dispensed=足额出钞；partial=部分出钞；failed=拒钞/未完成且已回补 */
  @Column({ type: 'varchar', length: 16, default: 'none' })
  reserveStatus!: 'none' | ReserveStatus;

  /** 已实际出钞金额，整数分。注意：计划/预占成功都不改变它。 */
  @Column({ type: 'int', default: 0, name: 'delivered_cents' })
  deliveredCents!: number;

  /** 已实际出钞总张数 */
  @Column({ type: 'int', default: 0, name: 'delivered_notes' })
  deliveredNotes!: number;

  /** 预占金额（预占成功后写入，出钞后保留用于对账） */
  @Column({ type: 'int', default: 0, name: 'reserved_cents' })
  reservedCents!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @OneToMany(() => CashLine, (line) => line.request, { cascade: true })
  lines!: CashLine[];
}
