// 全局数据契约：电路、组件、仿真与判题共用的类型定义。
// 仅包含类型，不包含任何逻辑；修改这里会影响所有模块，需同步检查判题与存档解析。
export type GateType = 'NAND' | 'NOT' | 'AND' | 'OR' | 'XOR' | 'XNOR' | 'CONST' | 'SPLIT' | 'JOIN' | 'DFF' | 'ROM' | 'RAM';
export type NodeType = 'INPUT' | 'OUTPUT' | GateType | 'COMPONENT';
export type Inputs = Record<string, number>;
export type Outputs = Record<string, number>;
/** 三值信号：number 表示各位均已知；'X' 表示全部未知；'1X0' 这类字符串表示部分位未知。 */
export type Signal = number | string;
export interface Port { id: string; label: string; bits: number; }
export interface CircuitNode {
  id: string; type: NodeType; label: string; position: { x: number; y: number };
  bits?: number; value?: number; componentKey?: string; words?: number[]; programSource?: string;
}
export interface Wire { id: string; source: string; sourceHandle: string; target: string; targetHandle: string; }
export interface CircuitGraph { nodes: CircuitNode[]; wires: Wire[]; }
/** revision 随每次编辑自增，UI 据此判断判题结果是否仍对应当前电路。 */
export interface Circuit extends CircuitGraph { levelId: number; revision: number; }
/**
 * 版本化组件定义。库键格式为 `${id}@${version}`：同名保存产生新版本，
 * 旧实例继续引用旧键，历史草稿与通关证明因此永不失效。
 */
export interface ComponentDefinition {
  id: string; version: number; name: string; inputs: Port[]; outputs: Port[];
  graph: CircuitGraph; dependencies: string[]; sourceLevel?: number; deleted?: true;
}
export type ComponentLibrary = Record<string, ComponentDefinition>;
/** 存储元件运行状态：registers/memories 按展开后的实例路径（如 c1/c2/g3）隔离。 */
export interface RuntimeState { registers: Record<string, Signal>; cycle: number; memories?: Record<string, Signal[]>; }
export interface SimulationStep { inputs: Inputs; tick: boolean; }
export interface TemporalStep extends SimulationStep { expectedOutputs: Outputs; }
export interface TestSequence { id: string; label: string; steps: TemporalStep[]; program?: number[]; }
export interface SimulationFrame { cycle: number; inputs: Inputs; outputs: Record<string, Signal>; tick: boolean; }
export interface Simulation {
  values: Record<string, Signal>; portValues: Record<string, Signal>; wires: Record<string, Signal>;
  state?: RuntimeState; trace?: SimulationFrame[]; activeProgram?: number[];
  program?: {caseId:string;outputs:Signal[];instructions:number;memory:Signal[];stopReason?:'halt'|'fault'|'breakpoint'|'budget'|'paused'};
}
/** 一行判题记录；mismatches 列出失配的输出端口，供反例回放与画布高亮使用。 */
export interface TestRow {
  inputs: Inputs; expected: number; actual: Signal; passed: boolean;
  expectedOutputs: Outputs; actualOutputs: Record<string, Signal>; mismatches: string[];
  scenarioId?: string; scenarioLabel?: string; stepIndex?: number; cycle?: number; tick?: boolean;
  program?: {expectedOutput:number[];actualOutput:Signal[];reason:string};
}
export interface TestResult { revision: number; passed: boolean; rows: TestRow[]; failure?: TestRow; error?: string; }
