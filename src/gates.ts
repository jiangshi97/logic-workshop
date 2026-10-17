// 门型清单的唯一权威：领域模型（model）与关卡编写 API（levelSpec）共同引用的叶子常量。
import type { GateType } from './contracts';

export const gateTypes: GateType[] = ['NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'CONST', 'SPLIT', 'JOIN', 'DFF', 'ROM', 'RAM'];
