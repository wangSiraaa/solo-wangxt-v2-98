import { DefaultNamingStrategy, NamingStrategyInterface, Table } from 'typeorm';

function snake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/** 统一 snake_case：所有手写 SQL 与 TypeORM 元数据列名一致，避免双轨命名 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  tableName(className: string, customName?: string): string {
    return customName ?? snake(className);
  }

  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    return (
      embeddedPrefixes.map((p) => snake(p)).join('_') +
      (customName ?? snake(propertyName))
    );
  }

  relationName(propertyName: string): string {
    return snake(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
  ): string {
    return `${firstTableName}_${secondTableName}`;
  }

  classTableInheritanceParentColumnName(
    parentTableName: string,
    parentTableId: string | Table,
  ): string {
    const idName = typeof parentTableId === 'string' ? parentTableId : parentTableId.name;
    return `${parentTableName}_${snake(idName)}`;
  }
}
