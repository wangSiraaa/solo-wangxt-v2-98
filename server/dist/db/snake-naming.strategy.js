"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnakeNamingStrategy = void 0;
const typeorm_1 = require("typeorm");
function snake(s) {
    return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
/** 统一 snake_case：所有手写 SQL 与 TypeORM 元数据列名一致，避免双轨命名 */
class SnakeNamingStrategy extends typeorm_1.DefaultNamingStrategy {
    tableName(className, customName) {
        return customName ?? snake(className);
    }
    columnName(propertyName, customName, embeddedPrefixes) {
        return (embeddedPrefixes.map((p) => snake(p)).join('_') +
            (customName ?? snake(propertyName)));
    }
    relationName(propertyName) {
        return snake(propertyName);
    }
    joinColumnName(relationName, referencedColumnName) {
        return snake(`${relationName}_${referencedColumnName}`);
    }
    joinTableName(firstTableName, secondTableName) {
        return `${firstTableName}_${secondTableName}`;
    }
    classTableInheritanceParentColumnName(parentTableName, parentTableId) {
        const idName = typeof parentTableId === 'string' ? parentTableId : parentTableId.name;
        return `${parentTableName}_${snake(idName)}`;
    }
}
exports.SnakeNamingStrategy = SnakeNamingStrategy;
//# sourceMappingURL=snake-naming.strategy.js.map