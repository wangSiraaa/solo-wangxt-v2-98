import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 钞箱：一种面额一个钞箱。所有金额/数量字段均为非负整数，金额单位 = 分。 */
@Entity('cassette')
export class Cassette {
  /** 面额，单位分（100/200/500/1000 = ¥1/¥2/¥5/¥10） */
  @PrimaryColumn({ type: 'int' })
  denomination!: number;

  /** 初始入库张数（核对时使用，只在 seed/reset 时变化） */
  @Column({ type: 'int', default: 0 })
  initialCount!: number;

  /** 当前实际可用张数（预占时扣减，出钞失败回补） */
  @Column({ type: 'int', default: 0 })
  remainingCount!: number;

  /** 累计已出钞张数（只增，模拟核对用） */
  @Column({ type: 'int', default: 0 })
  deliveredCount!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
