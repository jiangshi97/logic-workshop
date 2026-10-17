// 关卡编写 API：声明式 LevelSpec（JSON 兼容）的运行时校验与编译。
// 一份 spec 数据即可描述任意模式的关卡：文案、端口、可用门型、提示与期望值全部是数据；
// compileLevelSpec 把它编译成内部 Level——组合关期望来自表达式/真值表，时序关期望预填在帧里，
// 编程关用例进入下方注册表供 programmingSpec 查询。期望值依然独立于任何电路或仿真器。
// 21–56 关的有状态数学机器较复杂，仍以 TS 编写（defineLevel 同样走本编译器）；JSON 是推荐的新关卡入口。
import type { GateType, Inputs, Outputs, Port, TestSequence } from './contracts';
import type { Level } from './levels';
import type { ProgramCase } from './programmingSpec';
import { compileExpression } from './levelExpr';
import { gateTypes } from './gates';

/** 门类型解锁表：[门型, 首次可用关卡]，仅对第 1–20 关的组合关卡有推导意义。 */
export const gateUnlocks: [GateType, number][] = [
  ['NAND', 2], ['NOT', 4], ['AND', 5], ['OR', 6], ['XOR', 7], ['XNOR', 8],
  ['SPLIT', 11], ['JOIN', 11], ['CONST', 19],
];

export interface TruthTableRow { inputs: Record<string, number>; outputs: Record<string, number>; }
export interface CombinationalSpec {
  /** 每个输出端口一条整数表达式（见 levelExpr）；与 truthTable 二选一。 */
  expect?: Record<string, string>;
  truthTable?: TruthTableRow[];
  /** 公开测试集；缺省时判题穷举全部输入组合。 */
  cases?: Record<string, number>[];
}
export interface ScenarioSpec {
  /** 缺省自动生成 level-N-scenario-K。 */
  id?: string;
  label: string;
  steps: { inputs: Record<string, number>; tick?: boolean; expected: Record<string, number> }[];
}
export interface SequentialSpec { scenarios: ScenarioSpec[]; }
export interface ProgramCaseSpec {
  id?: string;
  label: string;
  /** 地址（"0"–"255"字符串键）到字节的映射。 */
  memory: Record<string, number>;
  expectedOutput: number[];
  maxCycles: number;
  expectedMemory?: Record<string, number>;
}
export interface ProgramSpec {
  cases: ProgramCaseSpec[];
  referenceSource?: string;
}
export interface LevelSpec {
  id: number;
  title: string;
  caption: string;
  goal: string;
  formula: string;
  /** 章节 1–7（新增章节需同步扩展 levels.ts 的 chapters 数组）。 */
  chapter: number;
  inputs: [string, number][];
  outputs: [string, number][];
  /** 本关可用门型；缺省时第 1–20 关按解锁表推导，其余取全部门型。 */
  allowed?: GateType[];
  hints: string[];
  rewardName?: string;
  defaultProgram?: number[];
  combinational?: CombinationalSpec;
  sequential?: SequentialSpec;
  program?: ProgramSpec;
}

/** 编程关用例注册表：spec 编译时登记，programmingCases 先查这里再回退到旧 switch。 */
export const programCaseRegistry = new Map<number, ProgramCase[]>();
/** 编程关参考汇编源注册表，programmingReferenceSource 优先查询。 */
export const programSourceRegistry = new Map<number, string>();

function fail(id: number, message: string): never {
  throw new Error(`关卡 ${id}：${message}`);
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;
const RESERVED_PORTS = new Set(['div', 'mod']);
const PORT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parsePorts(id: number, value: unknown, kind: string, seen: Set<string>): Port[] {
  if (!Array.isArray(value) || value.length === 0) fail(id, `${kind}端口不能为空。`);
  return value.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) fail(id, `${kind}端口必须是 [id, bits] 二元组。`);
    const name = text(entry[0]), bits = whole(entry[1]);
    if (!name || !PORT_NAME.test(name)) fail(id, `${kind}端口名“${String(entry[0])}”不合法。`);
    if (RESERVED_PORTS.has(name)) fail(id, `端口名“${name}”是表达式保留字。`);
    if (bits === undefined || bits < 1 || bits > 32) fail(id, `端口 ${name} 的位宽必须是 1–32。`);
    if (seen.has(name)) fail(id, `端口名“${name}”重复。`);
    seen.add(name);
    return { id: name, label: name, bits };
  });
}

/** 解析“整数值记录”：键须匹配 keyRange（端口名或字节地址），值须落在 [min, max]。 */
function parseIntRecord(id: number, value: unknown, label: string, keys: Set<string> | 'byte-address', min: number, max: number): Record<string, number> {
  if (!isRecord(value)) fail(id, `${label}必须是对象。`);
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numberValue = whole(raw);
    if (numberValue === undefined || numberValue < min || numberValue > max)
      fail(id, `${label}的“${key}”取值必须是 ${min}–${max} 的整数。`);
    if (keys === 'byte-address') {
      if (!/^\d+$/.test(key) || Number(key) > 255) fail(id, `${label}的地址“${key}”必须在 0–255。`);
    } else if (!keys.has(key)) fail(id, `${label}引用了未声明的端口“${key}”。`);
    result[key] = numberValue;
  }
  return result;
}

function validateCombinational(id: number, section: unknown, inputPorts: Port[], outputPorts: Port[]): CombinationalSpec {
  if (!isRecord(section)) fail(id, 'combinational 段必须是对象。');
  const spec = section as CombinationalSpec;
  const inputIds = new Set(inputPorts.map(p => p.id));
  const outputIds = new Set(outputPorts.map(p => p.id));
  const hasExpect = isRecord(spec.expect), hasTable = Array.isArray(spec.truthTable);
  if (hasExpect === hasTable) fail(id, 'combinational 段必须且只能提供 expect 表达式或 truthTable 之一。');
  if (hasExpect) {
    const expect = spec.expect as Record<string, string>;
    if (new Set(Object.keys(expect)).size !== outputIds.size || [...outputIds].some(o => !(o in expect)))
      fail(id, 'expect 必须恰好覆盖每个输出端口。');
    for (const [output, source] of Object.entries(expect)) {
      if (typeof source !== 'string') fail(id, `输出 ${output} 的表达式必须是字符串。`);
      try { compileExpression(source, inputIds); } catch (error) {
        fail(id, `输出 ${output} 的表达式无效：${(error as Error).message}`);
      }
    }
  } else {
    const limits = Object.fromEntries(inputPorts.map(p => [p.id, 2 ** p.bits - 1]));
    spec.truthTable!.forEach((row, index) => {
      if (!isRecord(row)) fail(id, `真值表第 ${index + 1} 行必须是对象。`);
      const inputs = parseIntRecord(id, row.inputs, `真值表第 ${index + 1} 行输入`, inputIds, 0, Infinity);
      for (const key of inputIds) if (!(key in inputs)) fail(id, `真值表第 ${index + 1} 行缺少输入端口“${key}”。`);
      const outputs = parseIntRecord(id, row.outputs, `真值表第 ${index + 1} 行输出`, new Set(outputIds), 0, Infinity);
      for (const key of outputIds) if (!(key in outputs)) fail(id, `真值表第 ${index + 1} 行缺少输出端口“${key}”。`);
      for (const [key, value] of Object.entries(inputs))
        if (value > limits[key]) fail(id, `真值表第 ${index + 1} 行输入“${key}”超出位宽。`);
      for (const [key, value] of Object.entries(outputs))
        if (value > 2 ** outputPorts.find(p => p.id === key)!.bits - 1) fail(id, `真值表第 ${index + 1} 行输出“${key}”超出位宽。`);
    });
  }
  if (spec.cases !== undefined) {
    if (!Array.isArray(spec.cases) || spec.cases.length === 0) fail(id, 'cases 必须是非空数组。');
    spec.cases.forEach((sample, index) => {
      const inputs = parseIntRecord(id, sample, `cases 第 ${index + 1} 项`, inputIds, 0, Infinity);
      for (const key of inputIds) if (!(key in inputs)) fail(id, `cases 第 ${index + 1} 项缺少输入端口“${key}”。`);
      for (const [port, value] of Object.entries(inputs))
        if (value > 2 ** inputPorts.find(p => p.id === port)!.bits - 1) fail(id, `cases 第 ${index + 1} 项输入“${port}”超出位宽。`);
    });
  }
  return spec;
}

function validateSequential(id: number, section: unknown, inputPorts: Port[], outputPorts: Port[]): SequentialSpec {
  if (!isRecord(section)) fail(id, 'sequential 段必须是对象。');
  const spec = section as unknown as SequentialSpec;
  if (!Array.isArray(spec.scenarios) || spec.scenarios.length === 0) fail(id, 'scenarios 不能为空。');
  const inputIds = new Set(inputPorts.map(p => p.id));
  const outputIds = new Set(outputPorts.map(p => p.id));
  spec.scenarios.forEach((scenario, index) => {
    if (!isRecord(scenario)) fail(id, `scenarios 第 ${index + 1} 项必须是对象。`);
    if (typeof scenario.label !== 'string' || !scenario.label) fail(id, `scenarios 第 ${index + 1} 项缺少 label。`);
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) fail(id, `场景“${scenario.label}”的 steps 不能为空。`);
    scenario.steps.forEach((step, stepIndex) => {
      if (!isRecord(step)) fail(id, `场景“${scenario.label}”第 ${stepIndex + 1} 步必须是对象。`);
      if (step.tick !== undefined && typeof step.tick !== 'boolean') fail(id, `场景“${scenario.label}”第 ${stepIndex + 1} 步的 tick 必须是布尔值。`);
      parseIntRecord(id, step.inputs, `场景“${scenario.label}”第 ${stepIndex + 1} 步输入`, inputIds, 0, Infinity);
      const expected = parseIntRecord(id, step.expected, `场景“${scenario.label}”第 ${stepIndex + 1} 步期望`, outputIds, 0, Infinity);
      for (const key of outputIds) if (!(key in expected)) fail(id, `场景“${scenario.label}”第 ${stepIndex + 1} 步缺少期望输出“${key}”。`);
      for (const [key, value] of Object.entries(expected))
        if (value > 2 ** outputPorts.find(p => p.id === key)!.bits - 1) fail(id, `场景“${scenario.label}”第 ${stepIndex + 1} 步期望“${key}”超出位宽。`);
    });
  });
  return spec;
}

function validateProgram(id: number, section: unknown): ProgramSpec {
  if (!isRecord(section)) fail(id, 'program 段必须是对象。');
  const spec = section as unknown as ProgramSpec;
  if (!Array.isArray(spec.cases) || spec.cases.length === 0) fail(id, 'program.cases 不能为空。');
  spec.cases.forEach((useCase, index) => {
    if (!isRecord(useCase)) fail(id, `program.cases 第 ${index + 1} 项必须是对象。`);
    if (typeof useCase.label !== 'string' || !useCase.label) fail(id, `program.cases 第 ${index + 1} 项缺少 label。`);
    parseIntRecord(id, useCase.memory, `用例“${useCase.label}”的 memory`, 'byte-address', 0, 255);
    if (!Array.isArray(useCase.expectedOutput) || useCase.expectedOutput.some(v => whole(v) === undefined || v < 0 || v > 255))
      fail(id, `用例“${useCase.label}”的 expectedOutput 必须是 0–255 的字节数组。`);
    const maxCycles = whole(useCase.maxCycles);
    if (maxCycles === undefined || maxCycles < 1 || maxCycles > 100000) fail(id, `用例“${useCase.label}”的 maxCycles 必须是 1–100000。`);
    if (useCase.expectedMemory !== undefined)
      parseIntRecord(id, useCase.expectedMemory, `用例“${useCase.label}”的 expectedMemory`, 'byte-address', 0, 255);
  });
  if (spec.referenceSource !== undefined && (typeof spec.referenceSource !== 'string' || spec.referenceSource.length > 32000))
    fail(id, 'referenceSource 必须是不超过 32000 字符的字符串。');
  return spec;
}

function validateLevelSpec(input: unknown): LevelSpec {
  if (!isRecord(input)) throw new Error('关卡必须是 JSON 对象。');
  const id = whole(input.id);
  if (id === undefined || id < 1) fail(id ?? 0, 'id 必须是正整数。');
  for (const key of ['title', 'caption', 'goal', 'formula'] as const)
    if (typeof input[key] !== 'string' || !(input[key] as string)) fail(id, `${key} 不能为空。`);
  const chapter = whole(input.chapter);
  if (chapter === undefined || chapter < 1 || chapter > 12) fail(id, 'chapter 必须是 1–12 的章节号。');
  if (!Array.isArray(input.hints) || input.hints.length !== 3 || input.hints.some(h => typeof h !== 'string' || !h))
    fail(id, 'hints 必须是恰好 3 条非空提示。');
  if (input.rewardName !== undefined && (typeof input.rewardName !== 'string' || !input.rewardName))
    fail(id, 'rewardName 必须是非空字符串。');
  const seen = new Set<string>();
  const inputPorts = parsePorts(id, input.inputs, '输入', seen);
  const outputPorts = parsePorts(id, input.outputs, '输出', seen);
  if (input.allowed !== undefined) {
    if (!Array.isArray(input.allowed) || input.allowed.length === 0 || input.allowed.some(g => !gateTypes.includes(g as GateType)))
      fail(id, 'allowed 必须是非空的已知门型数组。');
  }
  if (input.defaultProgram !== undefined) {
    if (!Array.isArray(input.defaultProgram) || input.defaultProgram.length > 256
      || input.defaultProgram.some(w => whole(w) === undefined || w < 0 || w > 65535))
      fail(id, 'defaultProgram 必须是最多 256 个 16 位指令字。');
  }
  const sections = (['combinational', 'sequential', 'program'] as const).filter(key => input[key] !== undefined);
  if (sections.length !== 1) fail(id, `必须且只能提供 combinational / sequential / program 之一，当前有 ${sections.length} 个。`);
  if (input.combinational !== undefined) validateCombinational(id, input.combinational, inputPorts, outputPorts);
  if (input.sequential !== undefined) validateSequential(id, input.sequential, inputPorts, outputPorts);
  if (input.program !== undefined) validateProgram(id, input.program);
  return input as unknown as LevelSpec;
}

const normalize = (value: number, bits: number): number => ((value % 2 ** bits) + 2 ** bits) % 2 ** bits;

/** 把声明式关卡编译为内部 Level：表达式闭包 / 真值表查找 / 帧时间线 / 编程用例注册。 */
export function compileLevelSpec(input: unknown): Level {
  const spec = validateLevelSpec(input);
  const inputPorts = spec.inputs.map(([id, bits]) => ({ id, label: id, bits }));
  const outputPorts = spec.outputs.map(([id, bits]) => ({ id, label: id, bits }));
  const defaults = Object.fromEntries(inputPorts.map(p => [p.id, 0]));
  const mode = spec.sequential ? 'sequential' as const : spec.program ? 'program' as const : undefined;
  const allowed = spec.allowed
    ?? (spec.id <= 20 ? gateUnlocks.filter(([, first]) => spec.id >= first).map(([type]) => type) : [...gateTypes]);

  const inputIds = inputPorts.map(p => p.id);
  const compiledExpressions = spec.combinational?.expect
    ? Object.fromEntries(Object.entries(spec.combinational.expect).map(([output, source]) =>
        [output, compileExpression(source, inputIds)]))
    : undefined;

  const expectedOutputs = (inputs: Inputs): Outputs => {
    if (spec.combinational?.truthTable) {
      const key = inputPorts.map(p => inputs[p.id]).join(',');
      const row = spec.combinational.truthTable.find(r => inputPorts.map(p => r.inputs[p.id]).join(',') === key);
      if (!row) throw new Error(`关卡 ${spec.id}：真值表缺少输入组合 (${key})。`);
      return { ...row.outputs };
    }
    if (compiledExpressions) {
      const outputs: Outputs = {};
      for (const [output, evaluate] of Object.entries(compiledExpressions)) {
        const bits = outputPorts.find(p => p.id === output)!.bits;
        outputs[output] = normalize(evaluate(inputs), bits);
      }
      return outputs;
    }
    // 时序/编程关的 expectedOutputs 仅供兼容展示：真正的判题走 sequences 场景与编程用例。
    if (spec.sequential) return { ...spec.sequential.scenarios[0].steps[0].expected };
    return {};
  };

  const sequences = spec.sequential
    ? (): TestSequence[] => spec.sequential!.scenarios.map((scenario, index) => ({
        id: scenario.id ?? `level-${spec.id}-scenario-${index + 1}`,
        label: scenario.label,
        steps: scenario.steps.map(step => ({
          inputs: { ...defaults, ...step.inputs },
          tick: step.tick ?? true,
          expectedOutputs: { ...step.expected },
        })),
      }))
    : undefined;

  if (spec.program) {
    programCaseRegistry.set(spec.id, spec.program.cases.map((useCase, index): ProgramCase => ({
      id: useCase.id ?? `program-${spec.id}-${index + 1}`,
      label: useCase.label,
      memory: Object.fromEntries(Object.entries(useCase.memory).map(([address, value]) => [Number(address), value])),
      expectedOutput: [...useCase.expectedOutput],
      maxCycles: useCase.maxCycles,
      ...(useCase.expectedMemory
        ? { expectedMemory: Object.fromEntries(Object.entries(useCase.expectedMemory).map(([address, value]) => [Number(address), value])) }
        : {}),
    })));
    if (spec.program.referenceSource) programSourceRegistry.set(spec.id, spec.program.referenceSource);
  }

  return {
    id: spec.id, title: spec.title, caption: spec.caption, goal: spec.goal, formula: spec.formula,
    chapter: spec.chapter,
    inputs: inputPorts.map(p => p.id), inputPorts, outputPorts, allowed,
    hints: [...spec.hints], rewardName: spec.rewardName,
    ...(spec.defaultProgram ? { defaultProgram: [...spec.defaultProgram] } : {}),
    expectedOutputs,
    ...(mode ? { mode } : {}),
    ...(sequences ? { sequences } : {}),
    ...(spec.combinational?.cases ? { cases: () => spec.combinational!.cases!.map(sample => ({ ...sample })) } : {}),
  };
}

/** TS 入口：类型化 spec 走同一编译器（含全部运行时校验），供复杂时序机关卡在 TS 中编写。 */
export function defineLevel(spec: LevelSpec): Level {
  return compileLevelSpec(spec);
}
