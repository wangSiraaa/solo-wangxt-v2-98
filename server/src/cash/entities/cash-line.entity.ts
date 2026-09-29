import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { CashRequest } from './cash-request.entity';

/**
 * 一张申请的某个组合的一行（面额 x 张数）。
 * picked=true 表示该组合被选中并用于预占/出钞。
 */
@Entity('cash_line')
export class CashLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @ManyToOne(() => CashRequest, (req) => req.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: CashRequest;

  /** 组合序号，0 起（0 为推荐组合：张数最少） */
  @Column({ type: 'int', name: 'option_index' })
  optionIndex!: number;

  @Column({ type: 'int' })
  denomination!: number;

  /** 计划使用张数 */
  @Column({ type: 'int' })
  plannedCount!: number;

  /** 预占张数（仅 picked 组合且预占成功后非 0） */
  @Column({ type: 'int', default: 0, name: 'reserved_count' })
  reservedCount!: number;

  /** 实际出钞张数（拒钞可 < 预占张数） */
  @Column({ type: 'int', default: 0, name: 'delivered_count' })
  deliveredCount!: number;

  /** 该组合是否被选中 */
  @Column({ type: 'boolean', default: false })
  picked!: boolean;
}
