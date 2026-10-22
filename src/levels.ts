// 关卡目录与聚合入口：基础目录 content/levels/*.json 与各关卡包 content/packs/*/*.json
// 一并经 levelRegistry 校验编译接入（期望值是纯整数表达式/物化帧数据，独立于任何电路或仿真器）。
// 新增关卡一律写进关卡包（见 docs/level-authoring.md"关卡包"一节），基础 57 关保持冻结；
// 关卡 id 只是稳定身份（包内编号 + 包 idBase），展示序号与解锁进度按目录位置计算（progress.ts）。
import type { GateType, Inputs, Outputs, Port, TestSequence } from './contracts';
import type { LevelHooks } from './levelPack';
import { levelPacks } from './levelPack';
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
  /** 所属关卡包键（levelPack.ts）；基础目录关卡无此字段。 */
  pack?: string;
  /** 关卡钩子声明（"包键/钩子名"），事件期由 App 经 levelPack 注册表解析触发。 */
  hooks?: LevelHooks;
}

const baseChapters = ['信号与逻辑门', '选择与分配', '多位信号', '组合运算', '状态与时间', '计算机架构', '编程应用'];
/** 章节标题 = 基础 7 章 + 各关卡包追加（关卡包扩展点之一）。 */
export const chapters = [...baseChapters, ...levelPacks.flatMap(pack => pack.chapters ?? [])];

export const levels: Level[] = specLevels();

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
