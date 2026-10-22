// 关卡目录与聚合入口。全部关卡均为 content/levels/ 下的 JSON 声明式定义，
// 由 levelRegistry 校验编译接入（期望值是纯整数表达式/物化帧数据，独立于任何电路或仿真器）；
// 固定机器与教学组件电路仍在 architectureCircuits / programmingMachine 中以代码维护。
// 新增关卡写 JSON 追加在最高号之后（见 docs/level-authoring.md），聚合时按 id 排序。
import type { GateType, Inputs, Outputs, Port, TestSequence } from './contracts';
import { specLevels } from './levelRegistry';
export type { GateType, Inputs } from './contracts';

/** 关卡描述：接口端口、允许门型、三层提示与期望值来源；mode 决定判题走哪条路径。 */
export interface Level {
  id: number;
  title: string;
  caption: string;
  goal: string;
  formula: string;
  chapter: number;
  inputs: string[];
  inputPorts: Port[];
  outputPorts: Port[];
  allowed: GateType[];
  hints: string[];
  rewardName?: string;
  expectedOutputs: (inputs: Inputs) => Outputs;
  mode?: 'sequential' | 'program';
  sequences?: () => TestSequence[];
  cases?: () => Inputs[];
  defaultProgram?: number[];
  /** 编程关绑定的目标计算机（machines.ts 注册表键）；缺省取注册表第一台。 */
  machine?: string;
}

export const chapters = ['信号与逻辑门', '选择与分配', '多位信号', '组合运算', '状态与时间', '计算机架构', '编程应用'];

export const levels: Level[] = [...specLevels()].sort((left, right) => left.id - right.id);
// 启动期守卫：关卡号必须唯一（排序后重复即相邻），防止两个 JSON 文件撞号。
if (levels.some((level, index) => index > 0 && level.id === levels[index - 1].id))
  throw new Error('关卡编号必须唯一，请检查 content/levels 下的关卡文件。');

export function getLevel(id: number): Level {
  const level = levels.find(level => level.id === id);
  if (!level) throw new Error('关卡不存在。');
  return level;
}

/** 取判题输入集：默认穷举全部输入组合（按端口从高位到低位编码）；关卡提供 cases 时用公开测试集；时序/编程模式为空。 */
export function testInputs(id: number): Inputs[] {
  const level = getLevel(id);
  if (level.mode === 'sequential' || level.mode === 'program') return [];
  if (level.cases) return level.cases();
  const ports = level.inputPorts;
  const totalBits = ports.reduce((total, p) => total + p.bits, 0);
  return Array.from({ length: 2 ** totalBits }, (_, index) => {
    let shift = totalBits;
    return Object.fromEntries(ports.map(p => {
      shift -= p.bits;
      return [p.id, (index >> shift) & ((1 << p.bits) - 1)];
    }));
  });
}

export function testSequences(id: number): TestSequence[] {
  return getLevel(id).sequences?.() ?? [];
}
