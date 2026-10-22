// 机器注册表：把此前关卡中构建出来的计算机登记为编程关可选的目标机器。
// 每台机器自带指令子集（汇编器据此拒绝越权指令）、初始电路（ROM 清空）与规范依赖闭包
// （存档不保存规范组件，载入时由代码重建——这是存档 v7 兼容设计的核心一环）。
// 扩展 ISA 时在此追加描述符（如 computer-60：13 条指令），旧机器保持不动，旧档永不失效。
import { architectureLibrary, architectureReferenceCircuit } from './architectureCircuits';
import { assemble } from './assembler';
import { programmingReferenceSource } from './programmingSpec';
import { levels } from './levels';
import type { Circuit, CircuitGraph, ComponentLibrary } from './contracts';

// 编程关卡集合从目录中 mode='program' 的关卡派生（当前 45–56）：
// 非编程关可以穿插在编程关之间或之后，因此不能用连续区间判定。
const programmingIds = new Set(levels.filter(level => level.mode === 'program').map(level => level.id));
export const isProgrammingLevel = (id: number): boolean => programmingIds.has(id);

/** 一台可编程计算机：在来源关卡通关（存档中存在证明）后，即可在任意编程关中选用。 */
export interface MachineDescriptor {
  /** 注册表键，关卡 JSON 的 program.machine 用它绑定默认机器。 */
  key: string;
  /** 展示名（选择器与汇编错误信息中使用）。 */
  name: string;
  /** 构建出这台计算机的关卡号。 */
  sourceLevel: number;
  /** 该机支持的指令助记符表。 */
  instructions: readonly string[];
  /** 该机在编程关 levelId 下的初始电路：整机图 + 清空待写的 ROM。 */
  circuit(levelId: number): Circuit;
  /** 该机的全部规范依赖组件（代码生成）。 */
  library(): ComponentLibrary;
}

const machineCircuit = (sourceLevel: number, levelId: number): Circuit => {
  const circuit = architectureReferenceCircuit(sourceLevel);
  return { ...circuit, levelId, nodes: circuit.nodes.map(n => n.id === 'program' ? { ...n, words: [] } : n) };
};
const closureOf = (sourceLevel: number): ComponentLibrary => {
  const bank = architectureLibrary(), needed = new Set<string>();
  const visit = (graph: CircuitGraph) => { for (const n of graph.nodes) if (n.type === 'COMPONENT' && !needed.has(n.componentKey!)) { needed.add(n.componentKey!); visit(bank[n.componentKey!].graph); } };
  visit(architectureReferenceCircuit(sourceLevel));
  return Object.fromEntries([...needed].sort().map(key => [key, bank[key]]));
};

/** 第 44 关整机：十条指令（当前唯一注册的机器）。 */
export const computer44: MachineDescriptor = {
  key: 'computer-44', name: '第 44 关计算机', sourceLevel: 44,
  instructions: ['NOP', 'MOVI', 'ADD', 'SUB', 'LOAD', 'STORE', 'JMP', 'JZ', 'OUT', 'HLT'],
  circuit: levelId => { if (!isProgrammingLevel(levelId)) throw new Error('编程关卡不存在。'); return machineCircuit(44, levelId); },
  library: () => closureOf(44),
};

/** 注册表即扩展点：新增计算机只需在此追加描述符（见 docs/code-guide.md）。 */
export const machines: readonly MachineDescriptor[] = [computer44];

export function machineByKey(key: string | undefined): MachineDescriptor {
  if (key === undefined) return machines[0]; // 关卡未绑定机器时缺省取注册表第一台
  const machine = machines.find(machine => machine.key === key);
  if (!machine) throw new Error(`未知计算机 ${key}；已注册：${machines.map(m => m.key).join('、')}。`);
  return machine;
}
/** 关卡绑定的默认机器：program.machine 缺省取注册表第一台。 */
export const machineForLevel = (levelId: number): MachineDescriptor =>
  machineByKey(levels.find(level => level.id === levelId)?.machine);

function stable(value: unknown): unknown {
  // stable 递归删除 undefined 键并按字典序排序对象键，使 JSON 比对不受字段顺序影响。
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
function graph(target: CircuitGraph, root = false) {
  // 规范化图：忽略位置、节点/导线按 id 排序；root=true 时再忽略 program 节点的 ROM 字与汇编源。
  return { nodes: target.nodes.map(({ position: _position, ...n }) => {
    if (root && n.id === 'program') { const { words: _words, programSource: _source, ...fixed } = n; return fixed; }
    return n;
  }).sort((a, b) => a.id.localeCompare(b.id)), wires: [...target.wires].sort((a, b) => a.id.localeCompare(b.id)) };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** 识别草稿当前持有哪台注册机器（忽略位置与 ROM 内容）；undefined 表示与任何机器都不符。 */
export function machineKeyOf(circuit: Circuit): MachineDescriptor | undefined {
  if (!isProgrammingLevel(circuit.levelId)) return undefined;
  const normalized = graph(circuit, true);
  return machines.find(machine => equal(normalized, graph(machine.circuit(circuit.levelId), true)));
}

/** 编程关卡初始/规范电路 = 关卡绑定机器，ROM 清空待玩家编写。 */
export function programmingMachine(levelId: number): Circuit { return machineForLevel(levelId).circuit(levelId); }
/** 默认机器（注册表第一台）的依赖闭包。 */
export function programmingMachineLibrary(): ComponentLibrary { return closureOf(machines[0].sourceLevel); }
/** 全部代码拥有的规范组件：架构教学组件全集 + 各机器依赖闭包的并集。
 * 解析存档时以此重建并覆盖同名条目（v7 起规范组件不落档）——教学元件与机器依赖同属规范面。 */
export function canonicalMachineLibrary(): ComponentLibrary {
  const merged: ComponentLibrary = architectureLibrary();
  for (const machine of machines) Object.assign(merged, machine.library());
  return Object.fromEntries(Object.keys(merged).sort().map(key => [key, merged[key]]));
}

/** 校验编程关卡：电路（不含 ROM 内容）必须与某一台注册机器逐字节等价，且该机的全部依赖与规范版本一致。 */
export function validateProgrammingMachine(circuit: Circuit, library: ComponentLibrary): string[] {
  if (!isProgrammingLevel(circuit.levelId)) return [];
  const machine = machineKeyOf(circuit);
  if (!machine) return ['编程关卡的固定机器电路被修改。'];
  for (const [key, canonical] of Object.entries(machine.library())) {
    const actual = library[key];
    if (!actual) return [`固定机器组件依赖缺失：${key}。`];
    if (!equal({ ...actual, graph: graph(actual.graph) }, { ...canonical, graph: graph(canonical.graph) })) return [`固定机器组件被修改：${key}。`];
  }
  return [];
}

/** Runtime session identity ignores layout but includes the ROM and all dependency contents. */
export function programmingSessionKey(circuit: Circuit, library: ComponentLibrary, caller?: string): string {
  return JSON.stringify(stable({ caller, levelId: circuit.levelId, graph: graph(circuit), library: Object.fromEntries(Object.entries(library).map(([key, def]) => [key, { ...def, graph: graph(def.graph) }])) }));
}
export function programmingReferenceCircuit(levelId: number): Circuit {
  const machine = machineForLevel(levelId), circuit = machine.circuit(levelId);
  const programSource = programmingReferenceSource(levelId), words = assemble(programSource, machine).words;
  return { ...circuit, nodes: circuit.nodes.map(n => n.id === 'program' ? { ...n, words, programSource } : n) };
}
