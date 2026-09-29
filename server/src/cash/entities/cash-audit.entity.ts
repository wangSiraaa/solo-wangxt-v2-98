import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 库存变动审计：任何 remainingCount 的增减都必须留痕，供守恒核对 */
@Entity('cash_audit')
export class CashAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  denomination!: number;

  /** 张数变化：预占为负，回补为正 */
  @Column({ type: 'int', name: 'delta_count' })
  deltaCount!: number;

  /** reserve | dispense-hold | dispense-reject | dispense-partial-refund | reset */
  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ type: 'uuid', nullable: true, name: 'request_id' })
  requestId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
