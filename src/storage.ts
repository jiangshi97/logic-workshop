// 版本化存档：Workspace 的创建、宽容解析（v1–v7 全兼容迁移）、证明重验与确定性稀疏序列化。
// 证明（proofs）独立于草稿电路：修改草稿不影响通关进度；导入时逐关重跑 judge 后才整体替换工作区。
// v7 设计要点：①关卡草稿稀疏存储，缺失的关卡按目录合成，任何未知/目录外关卡键只忽略不再拒档；
// ②组件库只保存玩家组件——规范机器依赖（architecture-*）载入时由代码重建并覆盖同名条目，
// 机库随 ISA/架构演进不再影响旧档，也杜绝了篡改规范组件的入口；③证明链照旧逐关重验，失败只降级进度。
import { createCircuit, validateCircuit, validateLibrary, validateWorkshopCircuit } from './model';
import { levels } from './levels';
import { judge } from './simulator';
import { assemble } from './assembler';
import { canonicalMachineLibrary, isProgrammingLevel, machineKeyOf, programmingMachine } from './machines';
import { pruneDeletedComponents } from './componentManagement';
import { levelPosition } from './progress';
import { LEVEL_EVENTS, type LevelEvent } from './levelPack';
import type { Circuit, CircuitGraph, CircuitNode, ComponentDefinition, ComponentLibrary, Inputs, NodeType, Port, Wire } from './contracts';

export const STORAGE_KEY = 'logic-workshop.v1';
/** 存档结构（version 7）：稀疏关卡草稿、通关证明、每关输入值、玩家组件库与可选的元件工坊草稿（levelId=0）。
 *  firedHooks 是关卡包钩子的一次性触发记录（v7 后期加法字段：老档缺省 = 全未触发，旧版本应用读到会忽略）。 */
export interface Workspace {
  version: 7;
  currentLevel: number;
  circuits: Record<number, Circuit>;
  proofs: Record<number, Circuit>;
  inputs: Record<number, Inputs>;
  library: ComponentLibrary;
  workshop?: Circuit;
  firedHooks?: Record<number, LevelEvent[]>;
}

export function createWorkspace(): Workspace {
  return { version: 7, currentLevel: levels[0].id, proofs: {}, library: canonicalMachineLibrary(),
    circuits: Object.fromEntries(levels.map(level => [level.id, level.mode === 'program' ? programmingMachine(level.id) : createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, level.mode === 'program' && name === 'E' ? 1 : 0]))])) };
}

const nodeTypes: NodeType[] = ['INPUT', 'OUTPUT', 'NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'CONST', 'SPLIT', 'JOIN', 'DFF', 'ROM', 'RAM', 'COMPONENT'];
// validId 同时排除 __proto__/constructor/prototype，防止存档 JSON 触发原型链污染。
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const validLabel = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const validBits = (value: unknown): value is number => value === 1 || value === 2 || value === 4 || value === 8 || value === 16;
function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

/** 解析并校验单张图；仅接受已知字段，非 ROM 节点携带 words/programSource 会被拒绝。 */
function parseGraph(raw: unknown): CircuitGraph {
  const graph = record(raw, '电路格式无效。');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.wires) || graph.nodes.length > 2000 || graph.wires.length > 5000) {
    throw new Error('电路格式或规模无效。');
  }
  const nodes: CircuitNode[] = graph.nodes.map(value => {
    const node = record(value, '组件格式无效。');
    const position = record(node.position, '组件位置无效。');
    if (!validId(node.id) || !validLabel(node.label) || !nodeTypes.includes(node.type as NodeType)
      || typeof position.x !== 'number' || typeof position.y !== 'number' || !Number.isFinite(position.x) || !Number.isFinite(position.y)
      || (node.bits !== undefined && !validBits(node.bits))) throw new Error('组件格式或位宽无效。');
    if (node.type === 'COMPONENT' && (typeof node.componentKey !== 'string' || node.componentKey.length > 210)) {
      throw new Error('组件依赖引用无效。');
    }
    const bits = node.bits === undefined ? 1 : node.bits as number;
    if ((node.type === 'ROM' && bits !== 16) || (node.type === 'RAM' && bits !== 8)) {
      throw new Error('存储器位宽无效。');
    }
    if (node.words !== undefined) {
      if (node.type !== 'ROM') throw new Error('只有 ROM 节点可以保存程序。');
      if (!Array.isArray(node.words) || node.words.length > 256
        || node.words.some(word => typeof word !== 'number' || !Number.isInteger(word) || word < 0 || word > 65535)) {
        throw new Error('ROM 程序必须包含至多 256 个十六位整数。');
      }
    }
    if (node.programSource !== undefined) {
      if (node.type !== 'ROM') throw new Error('只有 ROM 节点可以保存汇编源代码。');
      if (typeof node.programSource !== 'string' || node.programSource.length > 32_000) {
        throw new Error('汇编源代码必须为至多 32,000 字符的文本。');
      }
      const words = assemble(node.programSource).words;
      if (!Array.isArray(node.words) || words.length !== node.words.length
        || words.some((word, index) => word !== (node.words as number[])[index])) {
        throw new Error('汇编源代码与 ROM 程序字不一致。');
      }
    }
    if (node.value !== undefined && (typeof node.value !== 'number' || !Number.isInteger(node.value) || node.value < 0 || node.value >= 2 ** bits)) {
      throw new Error('常量数值无效。');
    }
    return { id: node.id, type: node.type as NodeType, label: node.label, position: { x: position.x, y: position.y },
      ...(node.bits === undefined ? {} : { bits }), ...(node.value === undefined ? {} : { value: node.value as number }),
      ...(node.type === 'ROM' && node.words !== undefined ? { words: [...node.words as number[]] } : {}),
      ...(node.type === 'ROM' && node.programSource !== undefined ? { programSource: node.programSource as string } : {}),
      ...(node.type === 'COMPONENT' ? { componentKey: node.componentKey as string } : {}) };
  });
  const wires: Wire[] = graph.wires.map(value => {
    const wire = record(value, '导线格式无效。');
    if (![wire.id, wire.source, wire.target, wire.sourceHandle, wire.targetHandle].every(validId)) throw new Error('导线格式无效。');
    return { id: wire.id as string, source: wire.source as string, target: wire.target as string,
      sourceHandle: wire.sourceHandle as string, targetHandle: wire.targetHandle as string };
  });
  return { nodes, wires };
}

function parseCircuit(raw: unknown, levelId: number, library: ComponentLibrary): Circuit {
  const value = record(raw, '电路格式无效。');
  if (value.levelId !== levelId || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('电路格式或关卡编号无效。');
  }
  const circuit: Circuit = { levelId, revision: value.revision as number, ...parseGraph(value) };
  const errors = validateCircuit(circuit, library);
  if (errors.length) throw new Error(errors[0]);
  // 图结构校验已确认草稿与某台注册机器等价；这里再确认汇编源只使用该机支持的指令子集。
  const machine = machineKeyOf(circuit);
  const source = machine && circuit.nodes.find(node => node.id === 'program')?.programSource;
  if (machine && source !== undefined) {
    try { assemble(source, machine); } catch (error) { throw new Error((error as Error).message); }
  }
  return circuit;
}

/** 工坊草稿解析：levelId 必须为 0 哨兵值，走不绑定关卡端口的校验。 */
function parseWorkshopCircuit(raw: unknown, library: ComponentLibrary): Circuit {
  const value = record(raw, '工坊草稿格式无效。');
  if (value.levelId !== 0 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('工坊草稿格式或编号无效。');
  }
  const circuit: Circuit = { levelId: 0, revision: value.revision as number, ...parseGraph(value) };
  const errors = validateWorkshopCircuit(circuit, library);
  if (errors.length) throw new Error(errors[0]);
  return circuit;
}

function parsePorts(raw: unknown): Port[] {
  if (!Array.isArray(raw) || raw.length > 128) throw new Error('组件接口格式无效。');
  return raw.map(value => {
    const port = record(value, '组件接口格式无效。');
    if (!validId(port.id) || !validLabel(port.label) || !validBits(port.bits)) throw new Error('组件接口或位宽无效。');
    return { id: port.id, label: port.label, bits: port.bits };
  });
}

function parseLibrary(raw: unknown): ComponentLibrary {
  const value = record(raw, '组件库格式无效。');
  if (Object.keys(value).length > 256) throw new Error('组件库超过 256 个版本的限制。');
  const library: ComponentLibrary = {};
  let nodeCount = 0;
  for (const [key, rawDefinition] of Object.entries(value)) {
    const definition = record(rawDefinition, '组件定义格式无效。');
    if (!validId(definition.id) || !validLabel(definition.name) || !Number.isSafeInteger(definition.version)
      || (definition.version as number) < 1 || key !== `${definition.id}@${definition.version}`
      || !Array.isArray(definition.dependencies) || definition.dependencies.length > 256
      || definition.dependencies.some(item => typeof item !== 'string' || item.length > 210)
      || new Set(definition.dependencies).size !== definition.dependencies.length) throw new Error('组件版本或依赖格式无效。');
    if (definition.sourceLevel !== undefined && !levels.some(level => level.id === definition.sourceLevel)) {
      throw new Error('组件来源关卡无效。');
    }
    const graph = parseGraph(definition.graph);
    nodeCount += graph.nodes.length;
    if (nodeCount > 20_000) throw new Error('组件库超过总规模限制。');
    if (definition.deleted !== undefined && definition.deleted !== true) throw new Error('组件删除状态无效。');
    const parsed: ComponentDefinition = { id: definition.id, version: definition.version as number, name: definition.name,
      inputs: parsePorts(definition.inputs), outputs: parsePorts(definition.outputs), graph,
      dependencies: [...definition.dependencies] as string[],
      ...(definition.sourceLevel === undefined ? {} : { sourceLevel: definition.sourceLevel as number }),
      ...(definition.deleted === true ? { deleted: true as const } : {}) };
    library[key] = parsed;
  }
  const errors = validateLibrary(library);
  if (errors.length) throw new Error(errors[0]);
  return library;
}

/**
 * 解析完整存档文本，v1–v6 老档全部宽容迁移到 v7：缺失草稿按目录合成、规范机库由代码重建
 * （存档中的 architecture-* 条目一律丢弃，防篡改也免迁移）、目录外/非数字关卡键只忽略不拒档。
 * 默认逐关重跑 judge 重验证明，全部通过才返回；verifyProofs:false 供测试跳过。
 */
export function parseWorkspace(text: string, options: { verifyProofs?: boolean } = {}): Workspace {
  if (text.length > 4_000_000) throw new Error('存档超过 4 MB 限制。');
  const raw = record(JSON.parse(text), '这不是兼容的逻辑工坊存档。');
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > 7) {
    throw new Error(typeof raw.version === 'number' && raw.version > 7 ? '存档来自更新版本的应用，请先升级再导入。' : '这不是兼容的逻辑工坊存档。');
  }
  const circuits = record(raw.circuits, '存档缺少电路。');
  const proofs = raw.proofs === undefined ? {} : record(raw.proofs, '通关记录格式无效。');
  const inputs = raw.inputs === undefined ? {} : record(raw.inputs, '输入状态格式无效。');
  const workspace = createWorkspace();
  // 组件库：规范库内的条目一律丢弃、由代码重建（防篡改也免迁移）；代码已不认识的旧键
  // （如更名前的 architecture-mux1@2）视同玩家组件保留，否则旧档里引用它的草稿会失效。
  const savedLibrary = raw.version === 1 || raw.library === undefined ? {} : record(raw.library, '组件库格式无效。');
  const canonical = canonicalMachineLibrary();
  const playerOnly = Object.fromEntries(Object.entries(savedLibrary).filter(([key]) => !canonical[key]));
  workspace.library = parseLibrary({ ...canonical, ...playerOnly });
  // 稀疏读取：只接受目录内、且不超出该版本历史上限（v1–4 分别只到 4/20/32/44 关）的关卡键；
  // 目录外、非数字与超上限的键一概忽略（实验关卡编号或更新版本写出的数据），不再让整档失效。
  const historicalCap = [Infinity, 4, 20, 32, 44, Infinity, Infinity, Infinity][raw.version as number];
  const catalogue = new Set(levels.map(level => level.id));
  const collect = (value: Record<string, unknown>): Record<number, unknown> => {
    const picked: Record<number, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!/^[1-9][0-9]*$/.test(key)) continue;
      const id = Number(key);
      if (catalogue.has(id) && id <= historicalCap) picked[id] = entry;
    }
    return picked;
  };
  const savedCircuits = collect(circuits), savedProofs = collect(proofs), savedInputs = collect(inputs);
  for (const level of levels) {
    if (savedCircuits[level.id] !== undefined) workspace.circuits[level.id] = parseCircuit(savedCircuits[level.id], level.id, workspace.library);
    if (savedProofs[level.id] !== undefined) workspace.proofs[level.id] = parseCircuit(savedProofs[level.id], level.id, workspace.library);
    if (savedInputs[level.id] !== undefined) {
      const values = record(savedInputs[level.id], '输入状态格式无效。');
      if (Object.keys(values).some(name => !level.inputs.includes(name))) throw new Error('输入端口无效。');
      for (const port of level.inputPorts) {
        const value = values[port.id];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 2 ** port.bits) {
          throw new Error(`输入 ${port.id} 超过位宽范围。`);
        }
        workspace.inputs[level.id][port.id] = value;
      }
    }
  }
  let unlocked = levels.length;
  if (options.verifyProofs !== false) {
    // 解锁进度 = 连续通过证明数 + 1；中断即丢弃其后的全部证明。
    const verified: Record<number, Circuit> = {};
    for (const level of levels) {
      const proof = workspace.proofs[level.id];
      if (!proof || !judge(proof, workspace.library).passed) break;
      verified[level.id] = proof;
    }
    workspace.proofs = verified;
    unlocked = Math.min(levels.length, Object.keys(verified).length + 1);
  }
  // currentLevel 是关卡 id：合法 = 在目录内且位置落在解锁前沿之内；否则回落到前沿关。
  // （基础目录 id 连续，与旧的 [1, unlocked] 数值区间完全等价；关卡包的稀疏 id 也按位置判定。）
  const requestedPosition = Number.isInteger(raw.currentLevel) ? levelPosition(raw.currentLevel as number) : -1;
  workspace.currentLevel = requestedPosition >= 0 && requestedPosition < unlocked
    ? raw.currentLevel as number : levels[Math.min(unlocked, levels.length) - 1].id;
  // 关卡钩子触发记录：只认目录内关卡与已知事件名，其余忽略（防重放；丢失最多导致一次性钩子再触发一次）。
  if (raw.firedHooks !== undefined) {
    const fired: Record<number, LevelEvent[]> = {};
    for (const [key, events] of Object.entries(record(raw.firedHooks, '钩子触发记录格式无效。'))) {
      if (!/^[1-9][0-9]*$/.test(key)) continue;
      const id = Number(key);
      if (!catalogue.has(id) || !Array.isArray(events)) continue;
      const valid = events.filter((event): event is LevelEvent => (LEVEL_EVENTS as readonly string[]).includes(event as string));
      if (valid.length) fired[id] = valid;
    }
    workspace.firedHooks = fired;
  }
  if (raw.workshop !== undefined) workspace.workshop = parseWorkshopCircuit(raw.workshop, workspace.library);
  return workspace;
}

/** 启动时读取 localStorage：无法解析内容时仍返回默认工作区，savedText 留给 Worker 异步重验。 */
export function loadWorkspace(): { workspace: Workspace; savedText?: string; error?: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return { workspace: createWorkspace(), ...(saved === null ? {} : { savedText: saved }) };
  } catch {
    return { workspace: createWorkspace(), error: '存档读取失败；新编辑会创建存档。' };
  }
}

/** 序列化为确定性 JSON：先清理不可达的已删除组件；与初始草稿完全一致的关卡省略
 *  （读取时按目录合成还原，round-trip 相等），规范机库组件不写入；space 供导出可读文件。 */
export function serializeWorkspace(workspace: Workspace, space?: number) {
  workspace = pruneDeletedComponents(workspace);
  const graph = (value: CircuitGraph): CircuitGraph => ({
    nodes: value.nodes.map(({ id, type, label, position, bits, value: constant, componentKey, words, programSource }) => ({
      id, type, label, position: { x: position.x, y: position.y },
      ...(bits === undefined ? {} : { bits }), ...(constant === undefined ? {} : { value: constant }),
      ...(type === 'COMPONENT' ? { componentKey } : {}),
      ...(type === 'ROM' && words !== undefined ? { words: [...words] } : {}),
      ...(type === 'ROM' && programSource !== undefined ? { programSource } : {}),
    })),
    wires: value.wires.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })),
  });
  const seedOf = (levelId: number): Circuit => isProgrammingLevel(levelId) ? programmingMachine(levelId) : createCircuit(levelId);
  const untouched = (circuit: Circuit): boolean => {
    const seed = seedOf(circuit.levelId);
    return circuit.revision === seed.revision && JSON.stringify(graph(circuit)) === JSON.stringify(graph(seed));
  };
  const circuits = (records: Record<number, Circuit>) => Object.fromEntries(Object.entries(records)
    .filter(([, circuit]) => !untouched(circuit))
    .map(([id, circuit]) => [id, { levelId: circuit.levelId, revision: circuit.revision, ...graph(circuit) }]));
  const ports = (records: Port[]) => records.map(({ id, label, bits }) => ({ id, label, bits }));
  const canonical = canonicalMachineLibrary();
  // 与解析对称：规范库内的条目不写入（载入时由代码重建）；代码不认识的旧规范键仍需落档供旧草稿引用。
  const library = Object.fromEntries(Object.entries(workspace.library)
    .filter(([key]) => !canonical[key])
    .map(([key, definition]) => [key, {
      id: definition.id, version: definition.version, name: definition.name,
      inputs: ports(definition.inputs), outputs: ports(definition.outputs), dependencies: [...definition.dependencies],
      ...(definition.sourceLevel === undefined ? {} : { sourceLevel: definition.sourceLevel }),
      ...(definition.deleted ? { deleted: true } : {}), graph: graph(definition.graph),
    }]));
  return JSON.stringify({ version: workspace.version, currentLevel: workspace.currentLevel,
    circuits: circuits(workspace.circuits), proofs: circuits(workspace.proofs), inputs: workspace.inputs, library,
    ...(workspace.workshop ? { workshop: { levelId: 0, revision: workspace.workshop.revision, ...graph(workspace.workshop) } } : {}),
    ...(workspace.firedHooks && Object.keys(workspace.firedHooks).length ? { firedHooks: workspace.firedHooks } : {}),
  }, null, space);
}

export function saveWorkspace(workspace: Workspace) {
  localStorage.setItem(STORAGE_KEY, serializeWorkspace(workspace));
}
