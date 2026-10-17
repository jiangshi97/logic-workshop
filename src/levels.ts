// 关卡目录与聚合入口。第 1–20 关（组合逻辑）已迁移为 content/levels/ 下的 JSON 声明式关卡，
// 由 levelRegistry 校验编译接入（期望值是纯整数表达式，依然独立于任何电路或仿真器）。
// 第 21–32/33–44/45–56 关因带状态数学机器仍以 TS 定义；新增关卡优先写 JSON（见 docs/level-authoring.md）。
import type { GateType, Inputs, Outputs, Port, TestSequence } from './contracts';
import { specLevels } from './levelRegistry';
import { sequentialLevels } from './sequentialLevels';
import { architectureLevels } from './architectureLevels';
import { programmingLevels } from './programmingLevels';
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
}

export const chapters = ['信号与逻辑门', '选择与分配', '多位信号', '组合运算', '状态与时间', '计算机架构', '编程应用'];

export const levels: Level[] = [
  ...specLevels(),
  ...sequentialLevels,
  ...architectureLevels,
  ...programmingLevels,
];
// 启动期守卫：关卡号必须严格递增，防止 JSON 与 TS 两处来源出现重复或乱序。
if (levels.some((level, index) => index > 0 && level.id <= levels[index - 1].id))
  throw new Error('关卡编号必须严格递增，请检查 content/levels 与各阶段关卡文件。');

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
