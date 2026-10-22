// 教学组件库与参考电路：用 Builder DSL 生成 23 个可查看、可展开的门级组件
// （mux1–16、register1–16、adder8、increment8、addsub、alu、registers、pc、decode、predecode、
//  phase、controller、output、datapath、fetch、memory、computer）及第 33–44 关参考电路。
// architectureLibrary() 每次返回全新对象，调用方可安全保存/修改自己的副本。
import type { Circuit, CircuitGraph, CircuitNode, ComponentDefinition, ComponentLibrary, GateType, Port } from './contracts';
import { getLevel } from './levels';

type Pin = { node: string; port: string };
type Spec = [string, number][];
const key = (id: string) => `architecture-${id}@1`;
const ports = (spec: Spec): Port[] => spec.map(([id, bits]) => ({ id, label: id, bits }));

/** Small, inspectable gates and state cells; component interfaces are real graph boundaries. */
/** 电路搭建 DSL：gate/not/and/or/split/join/mux/reg/dff/component 等原语，产出标准 CircuitGraph。
 *  导出供关卡包在其目录内构建新机器的电路（见 src/levelPack.ts 与 docs/level-authoring.md）。 */
export class Builder {
  graph: CircuitGraph = { nodes: [], wires: [] };
  count = 0;
  constructor(readonly inputs: Spec, readonly outputs: Spec) {
    for (const [type, list] of [['INPUT', inputs], ['OUTPUT', outputs]] as const) {
      list.forEach(([id, bits], i) => this.graph.nodes.push({ id, bits, type, label: id,
        position: { x: type === 'INPUT' ? 40 : 1650, y: 50 + i * 165 } }));
    }
  }
  pin(node: string, port = 'out'): Pin { return { node, port }; }
  wire(source: Pin, target: string, targetHandle: string) {
    this.graph.wires.push({ id: `w${this.graph.wires.length + 1}`, source: source.node, sourceHandle: source.port, target, targetHandle });
  }
  node(type: CircuitNode['type'], bits = 1, props: Partial<CircuitNode> = {}, requestedId?: string): string {
    const index = this.count++, id = requestedId ?? `g${index + 1}`;
    this.graph.nodes.push({ id, type, bits, label: type,
      position: { x: 300 + index % 5 * 250, y: 60 + Math.floor(index / 5) * 470 }, ...props });
    return id;
  }
  gate(type: GateType, a: Pin, b?: Pin, bits = 1): Pin {
    const id = this.node(type, bits); this.wire(a, id, 'a'); if (b) this.wire(b, id, 'b'); return this.pin(id);
  }
  not(a: Pin, bits = 1) { return this.gate('NOT', a, undefined, bits); }
  and(...values: Pin[]) { return values.reduce((a, b) => this.gate('AND', a, b)); }
  or(...values: Pin[]) { return values.reduce((a, b) => this.gate('OR', a, b)); }
  constant(value: number, bits = 1) { return this.pin(this.node('CONST', bits, { value })); }
  split(a: Pin, bits: number): Pin[] {
    const id = this.node('SPLIT', bits); this.wire(a, id, 'in');
    return Array.from({ length: bits }, (_, i) => this.pin(id, `out${i}`));
  }
  join(values: Pin[]) {
    const id = this.node('JOIN', values.length); values.forEach((v, i) => this.wire(v, id, `in${i}`)); return this.pin(id);
  }
  output(a: Pin, id: string) { this.wire(a, id, 'in'); }
  component(id: string, inputs: Record<string, Pin>, requestedId?: string): (port: string) => Pin {
    const node = this.node('COMPONENT', 1, { componentKey: key(id), label: names[id] ?? id }, requestedId);
    Object.entries(inputs).forEach(([port, value]) => this.wire(value, node, port));
    return port => this.pin(node, port);
  }
  mux(a: Pin, c: Pin, select: Pin, bits = 1) { return this.component(`mux${bits}`, { A: a, B: c, S: select })('Y'); }
  reg(data: Pin, enable: Pin, reset: Pin, bits: number, requestedId?: string) {
    return this.component(`register${bits}`, { D: data, E: enable, R: reset }, requestedId)('Q');
  }
  dff(bits: number, reset: Pin, requestedId?: string) {
    const id = this.node('DFF', bits, {}, requestedId); this.wire(reset, id, 'rst'); return { id, q: this.pin(id, 'q') };
  }
  equal(bits: Pin[], value: number): Pin { return this.and(...bits.map((bit, i) => value & 1 << i ? bit : this.not(bit))); }
  zero(a: Pin, bits: number): Pin { return this.not(this.or(...this.split(a, bits))); }
}

const names: Record<string, string> = {
  mux1: '一位选择器', mux2: '两位选择器', mux8: '八位选择器', mux16: '十六位选择器',
  register1: '一位使能寄存器', register2: '两位使能寄存器', register8: '八位使能寄存器', register16: '十六位使能寄存器',
  adder8: '八位进位加法器', increment8: '八位递增器', addsub: '八位加减器', alu: '八位 ALU',
  registers: '双寄存器组', pc: '程序计数器', decode: '指令字段与合法性', predecode: '指令操作码译码',
  phase: '三阶段时序', controller: '指令控制器', output: '输出端口', datapath: '指令数据通路',
  fetch: '取指电路', memory: '字节存储器', computer: '八位计算机',
};

function definition(id: string, sourceLevel: number, b: Builder): ComponentDefinition {
  return { id: `architecture-${id}`, version: 1, name: names[id] ?? id, sourceLevel,
    inputs: ports(b.inputs), outputs: ports(b.outputs), graph: b.graph,
    dependencies: [...new Set(b.graph.nodes.filter(n => n.type === 'COMPONENT').map(n => n.componentKey!))].sort() };
}

function buildLibrary(): ComponentLibrary {
  const library: ComponentLibrary = {};
  const add = (id: string, sourceLevel: number, b: Builder) => { library[key(id)] = definition(id, sourceLevel, b); };
  for (const bits of [1, 2, 8, 16]) {
    const b = new Builder([['A', bits], ['B', bits], ['S', 1]], [['Y', bits]]);
    const s = bits === 1 ? b.pin('S') : b.join(Array<Pin>(bits).fill(b.pin('S')));
    b.output(b.gate('OR', b.gate('AND', b.pin('A'), b.not(s, bits), bits), b.gate('AND', b.pin('B'), s, bits), bits), 'Y');
    add(`mux${bits}`, bits === 16 ? 37 : 24, b);
    const r = new Builder([['D', bits], ['E', 1], ['R', 1]], [['Q', bits]]);
    const d = r.dff(bits, r.pin('R')); r.wire(r.mux(d.q, r.pin('D'), r.pin('E'), bits), d.id, 'd'); r.output(d.q, 'Q');
    add(`register${bits}`, bits === 16 ? 37 : 24, r);
  }
  {
    const b = new Builder([['A', 8], ['B', 8], ['Cin', 1]], [['Y', 8], ['Cout', 1]]);
    const a = b.split(b.pin('A'), 8), v = b.split(b.pin('B'), 8), sums: Pin[] = []; let carry = b.pin('Cin');
    for (let i = 0; i < 8; i++) {
      const xor = b.gate('XOR', a[i], v[i]); sums.push(b.gate('XOR', xor, carry));
      carry = b.or(b.and(a[i], v[i]), b.and(xor, carry));
    }
    b.output(b.join(sums), 'Y'); b.output(carry, 'Cout'); add('adder8', 20, b);
    const inc = new Builder([['A', 8]], [['Y', 8]]), aBits = inc.split(inc.pin('A'), 8), out: Pin[] = []; let c = inc.constant(1);
    aBits.forEach((bit, i) => { out.push(inc.gate('XOR', bit, c)); if (i < 7) c = inc.and(bit, c); });
    inc.output(inc.join(out), 'Y'); add('increment8', 26, inc);
  }
  {
    const b = new Builder([['A', 8], ['B', 8], ['Sub', 1]], [['Y', 8], ['Carry', 1], ['Borrow', 1], ['Z', 1]]);
    const inverted = b.gate('XOR', b.pin('B'), b.join(Array<Pin>(8).fill(b.pin('Sub'))), 8);
    const sum = b.component('adder8', { A: b.pin('A'), B: inverted, Cin: b.pin('Sub') });
    b.output(sum('Y'), 'Y'); b.output(b.and(sum('Cout'), b.not(b.pin('Sub'))), 'Carry');
    b.output(b.and(b.not(sum('Cout')), b.pin('Sub')), 'Borrow'); b.output(b.zero(sum('Y'), 8), 'Z'); add('addsub', 33, b);
  }
  {
    const b = new Builder([['A', 8], ['B', 8], ['Op', 2]], [['Y', 8], ['Carry', 1], ['Borrow', 1], ['Z', 1]]);
    const op = b.split(b.pin('Op'), 2), arithmetic = b.component('addsub', { A: b.pin('A'), B: b.pin('B'), Sub: op[0] });
    const logic = b.mux(b.gate('AND', b.pin('A'), b.pin('B'), 8), b.gate('XOR', b.pin('A'), b.pin('B'), 8), op[0], 8);
    const y = b.mux(arithmetic('Y'), logic, op[1], 8); b.output(y, 'Y');
    b.output(b.and(arithmetic('Carry'), b.not(op[1])), 'Carry'); b.output(b.and(arithmetic('Borrow'), b.not(op[1])), 'Borrow');
    b.output(b.zero(y, 8), 'Z'); add('alu', 34, b);
  }
  {
    const b = new Builder([['D', 8], ['WA', 1], ['WB', 1], ['R', 1]], [['A', 8], ['B', 8]]);
    b.output(b.reg(b.pin('D'), b.pin('WA'), b.pin('R'), 8), 'A'); b.output(b.reg(b.pin('D'), b.pin('WB'), b.pin('R'), 8), 'B'); add('registers', 35, b);
    const p = new Builder([['E', 1], ['Jump', 1], ['Target', 8], ['R', 1]], [['PC', 8]]), cell = p.dff(8, p.pin('R'));
    const increment = p.component('increment8', { A: cell.q })('Y');
    p.wire(p.mux(cell.q, p.mux(increment, p.pin('Target'), p.pin('Jump'), 8), p.pin('E'), 8), cell.id, 'd');
    p.output(cell.q, 'PC'); add('pc', 36, p);
  }
  {
    const b = new Builder([['Instruction', 16]], [['Opcode', 4], ['Param', 4], ['Imm', 8], ['Valid', 1]]);
    const bits = b.split(b.pin('Instruction'), 16), opcode = bits.slice(12), param = bits.slice(8, 12), imm = bits.slice(0, 8);
    b.output(b.join(opcode), 'Opcode'); b.output(b.join(param), 'Param'); b.output(b.join(imm), 'Imm');
    const op = Array.from({ length: 10 }, (_, n) => b.equal(opcode, n)), p0 = b.equal(param, 0), p1 = b.equal(param, 1), imm0 = b.not(b.or(...imm));
    const noImmediate = b.and(b.or(op[0], op[2], op[3], op[8], op[9]), p0, imm0);
    const address = b.and(b.or(op[4], op[5], op[6], op[7]), p0);
    b.output(b.or(noImmediate, address, b.and(op[1], b.or(p0, p1))), 'Valid'); add('decode', 37, b);
    const pre = new Builder([['Instruction', 16]], [['Imm', 8], ['SelectB', 1], ['Valid', 1], ...Array.from({ length: 10 }, (_, i): [string, number] => [`Op${i}`, 1])]);
    const decoded = pre.component('decode', { Instruction: pre.pin('Instruction') }), codes = pre.split(decoded('Opcode'), 4), p = pre.split(decoded('Param'), 4);
    pre.output(decoded('Imm'), 'Imm'); pre.output(p[0], 'SelectB'); pre.output(decoded('Valid'), 'Valid');
    Array.from({ length: 10 }, (_, i) => pre.output(pre.equal(codes, i), `Op${i}`)); add('predecode', 37, pre);
  }
  {
    const b = new Builder([['E', 1], ['Stop', 1], ['R', 1]], [['Phase', 2], ['Execute', 1]]), cell = b.dff(2, b.pin('R'));
    const q = b.split(cell.q, 2), next = b.join([b.not(b.or(q[0], q[1])), b.and(q[0], b.not(q[1]))]);
    b.wire(b.mux(cell.q, next, b.and(b.pin('E'), b.not(b.pin('Stop'))), 2), cell.id, 'd');
    b.output(cell.q, 'Phase'); b.output(b.and(q[1], b.not(q[0])), 'Execute'); add('phase', 39, b);
  }
  {
    const b = new Builder([['Instruction', 16], ['Z', 1], ['Phase', 2]], [['WA', 1], ['WB', 1], ['ALUOp', 2], ['MemWrite', 1], ['MemRead', 1], ['Jump', 1], ['OutWrite', 1], ['Halt', 1], ['Invalid', 1]]);
    const d = b.component('predecode', { Instruction: b.pin('Instruction') }), execute = b.equal(b.split(b.pin('Phase'), 2), 2), active = b.and(execute, d('Valid'));
    const op = (i: number) => d(`Op${i}`), controls: Record<string, Pin> = {
      WA: b.or(b.and(op(1), b.not(d('SelectB'))), op(2), op(3), op(4)), WB: b.and(op(1), d('SelectB')),
      MemWrite: op(5), MemRead: op(4), Jump: b.or(op(6), b.and(op(7), b.pin('Z'))), OutWrite: op(8), Halt: op(9),
    };
    Object.entries(controls).forEach(([name, signal]) => b.output(b.and(active, signal), name));
    b.output(b.join([b.and(active, op(3)), b.constant(0)]), 'ALUOp'); b.output(b.not(d('Valid')), 'Invalid'); add('controller', 40, b);
    const out = new Builder([['D', 8], ['Write', 1], ['R', 1]], [['Out', 8]]);
    out.output(out.reg(out.pin('D'), out.pin('Write'), out.pin('R'), 8), 'Out'); add('output', 42, out);
  }
  {
    const b = new Builder([['Instruction', 16], ['Data', 8], ['Exec', 1], ['R', 1]],
      [['A', 8], ['B', 8], ['Z', 1], ['Out', 8], ['Halt', 1], ['Fault', 1], ['Jump', 1], ['Target', 8], ['Addr', 8], ['Store', 8], ['MemWrite', 1], ['MemRead', 1]]);
    const halt = b.dff(1, b.pin('R'), 'halt-state'), fault = b.dff(1, b.pin('R'), 'fault-state'), z = b.dff(1, b.pin('R'), 'zero-state');
    const ctrl = b.component('controller', { Instruction: b.pin('Instruction'), Z: z.q, Phase: b.constant(2, 2) }, 'controller');
    const decode = b.component('decode', { Instruction: b.pin('Instruction') }, 'fields');
    const enabled = b.and(b.pin('Exec'), b.not(halt.q)), active = b.and(enabled, b.not(ctrl('Invalid')));
    b.wire(b.or(halt.q, b.and(enabled, b.or(ctrl('Halt'), ctrl('Invalid')))), halt.id, 'd');
    b.wire(b.or(fault.q, b.and(enabled, ctrl('Invalid'))), fault.id, 'd');
    const a = b.dff(8, b.pin('R'), 'A-state'), v = b.dff(8, b.pin('R'), 'B-state');
    const alu = b.component('alu', { A: a.q, B: v.q, Op: ctrl('ALUOp') }, 'alu');
    // MOVI, LOAD and arithmetic share the register write bus.
    const opcode = b.split(decode('Opcode'), 4), arithmetic = b.or(b.equal(opcode, 2), b.equal(opcode, 3));
    const writeBus = b.mux(b.mux(decode('Imm'), alu('Y'), arithmetic, 8), b.pin('Data'), ctrl('MemRead'), 8);
    const wa = b.and(active, ctrl('WA')), wb = b.and(active, ctrl('WB'));
    b.wire(b.mux(a.q, writeBus, wa, 8), a.id, 'd'); b.wire(b.mux(v.q, writeBus, wb, 8), v.id, 'd');
    b.wire(b.mux(z.q, b.zero(writeBus, 8), wa), z.id, 'd');
    const output = b.component('output', { D: a.q, Write: b.and(active, ctrl('OutWrite')), R: b.pin('R') }, 'output-port');
    for (const [id, signal] of Object.entries({ A: a.q, B: v.q, Z: z.q, Out: output('Out'), Halt: halt.q, Fault: fault.q,
      Jump: b.and(active, ctrl('Jump')), Target: decode('Imm'), Addr: decode('Imm'), Store: a.q,
      MemWrite: b.and(active, ctrl('MemWrite')), MemRead: b.and(active, ctrl('MemRead')) })) b.output(signal, id);
    add('datapath', 43, b);
  }
  // Completed stage graphs remain available as reusable, expandable definitions.
  // The level-44 reference itself still has all CPU blocks visible in its root graph.
  for (const [id, name] of [[38, 'fetch'], [41, 'memory'], [44, 'computer']] as const) {
    const circuit = architectureReferenceCircuit(id), level = getLevel(id);
    const b = new Builder(level.inputPorts.map(p => [p.id, p.bits]), level.outputPorts.map(p => [p.id, p.bits]));
    b.graph = { nodes: circuit.nodes, wires: circuit.wires }; add(name, id, b);
  }
  return library;
}

/** Fresh deterministic definitions; callers may safely save, edit or expand their own copy. */
export function architectureLibrary(): ComponentLibrary { return buildLibrary(); }

/** 依赖闭包：从 bank 里收集 graph（递归展开）引用到的全部组件定义。
 *  关卡包机器的 library() 用它对自己的组件库与整机图求闭包。 */
export function dependencyClosure(bank: ComponentLibrary, graph: CircuitGraph): ComponentLibrary {
  const needed = new Set<string>();
  const visit = (target: CircuitGraph) => {
    for (const node of target.nodes) if (node.type === 'COMPONENT' && !needed.has(node.componentKey!)) {
      const definition = bank[node.componentKey!];
      if (!definition) throw new Error(`组件 ${node.componentKey} 不在组件库中。`);
      needed.add(node.componentKey!);
      visit(definition.graph);
    }
  };
  visit(graph);
  return Object.fromEntries([...needed].sort().map(key => [key, bank[key]]));
}

const lessonModules: Record<number, string> = { 33: 'addsub', 34: 'alu', 35: 'registers', 36: 'pc', 37: 'decode', 39: 'phase', 40: 'controller', 42: 'output', 43: 'datapath' };

function layoutMachine(graph: CircuitGraph, id: number) {
  const places: Record<string, { x: number; y: number }> = id === 44 ? {
    pc: { x: 280, y: 70 }, program: { x: 560, y: 70 }, 'instruction-register': { x: 840, y: 70 },
    controller: { x: 1120, y: 70 }, phase: { x: 280, y: 430 }, datapath: { x: 760, y: 430 }, memory: { x: 1120, y: 500 },
  } : { pc: { x: 300, y: 100 }, program: { x: 600, y: 100 }, 'instruction-register': { x: 900, y: 100 } };
  let input = 0, output = 0, glue = 0;
  for (const node of graph.nodes) {
    if (places[node.id]) node.position = places[node.id];
    else if (node.type === 'INPUT') node.position = { x: 40, y: 70 + input++ * 150 };
    else if (node.type === 'OUTPUT') {
      const index = output++;
      node.position = id === 44 ? { x: 1490 + Math.floor(index / 5) * 200, y: 70 + index % 5 * 150 }
        : { x: 1200, y: 100 + index * 250 };
    } else {
      const index = glue++;
      // Root glue contains only short gates and a two-bit splitter; wide splitters stay inside modules.
      node.position = { x: 280 + index % 6 * 220, y: 900 + Math.floor(index / 6) * 150 };
    }
  }
}

/** The CPU deliberately exposes its timing, PC, instruction register, ROM, RAM and data path. */
/** 生成某关的参考电路：33–43 关为单个教学模块直连；41 关为 RAM；38/44 关为手工连接的取指/整机图。 */
export function architectureReferenceCircuit(id: number): Circuit {
  const level = getLevel(id), spec = (list: Port[]): Spec => list.map(p => [p.id, p.bits]);
  const b = new Builder(spec(level.inputPorts), spec(level.outputPorts));
  if (lessonModules[id]) {
    const block = b.component(lessonModules[id], Object.fromEntries(level.inputPorts.map(p => [p.id, b.pin(p.id)])), 'reference');
    level.outputPorts.forEach(p => b.output(block(p.id), p.id));
  } else if (id === 41) {
    const ram = b.node('RAM', 8, {}, 'memory');
    for (const [port, input] of [['addr', 'Addr'], ['d', 'D'], ['we', 'W'], ['rst', 'R']]) b.wire(b.pin(input), ram, port);
    b.output(b.pin(ram, 'q'), 'Q');
  } else if (id === 38 || id === 44) {
    const program = b.node('ROM', 16, { words: [...(level.defaultProgram ?? [])] }, 'program');
    if (id === 38) {
      const pc = b.component('pc', { E: b.pin('E'), Jump: b.pin('Jump'), Target: b.pin('Target'), R: b.pin('R') }, 'pc');
      b.wire(pc('PC'), program, 'addr');
      const ir = b.reg(b.pin(program, 'q'), b.pin('E'), b.pin('R'), 16, 'instruction-register');
      b.output(pc('PC'), 'PC'); b.output(ir, 'IR');
    } else {
      // Connect graph boundaries after allocating them: all state feedback crosses DFFs.
      const phaseId = b.node('COMPONENT', 1, { componentKey: key('phase'), label: names.phase }, 'phase');
      const dataId = b.node('COMPONENT', 1, { componentKey: key('datapath'), label: names.datapath }, 'datapath');
      const irId = b.node('COMPONENT', 1, { componentKey: key('register16'), label: '指令寄存器' }, 'instruction-register');
      const phase = (p: string) => b.pin(phaseId, p), data = (p: string) => b.pin(dataId, p), ir = b.pin(irId, 'Q');
      const ctrl = b.component('controller', { Instruction: ir, Z: data('Z'), Phase: phase('Phase') }, 'controller');
      const haltEvent = b.or(data('Halt'), data('Fault'), b.and(phase('Execute'), b.or(ctrl('Halt'), ctrl('Invalid'))));
      b.wire(b.pin('E'), phaseId, 'E'); b.wire(haltEvent, phaseId, 'Stop'); b.wire(b.pin('R'), phaseId, 'R');
      const pc = b.component('pc', { E: b.and(b.pin('E'), phase('Execute'), b.not(haltEvent)), Jump: data('Jump'), Target: data('Target'), R: b.pin('R') }, 'pc');
      b.wire(pc('PC'), program, 'addr'); b.wire(b.pin(program, 'q'), irId, 'D'); b.wire(b.pin('R'), irId, 'R');
      b.wire(b.and(b.pin('E'), b.equal(b.split(phase('Phase'), 2), 0), b.not(data('Halt'))), irId, 'E');
      const ram = b.node('RAM', 8, {}, 'memory');
      b.wire(data('Addr'), ram, 'addr'); b.wire(data('Store'), ram, 'd'); b.wire(data('MemWrite'), ram, 'we'); b.wire(b.pin('R'), ram, 'rst');
      b.wire(ir, dataId, 'Instruction'); b.wire(b.pin(ram, 'q'), dataId, 'Data');
      b.wire(b.and(b.pin('E'), phase('Execute')), dataId, 'Exec'); b.wire(b.pin('R'), dataId, 'R');
      b.output(pc('PC'), 'PC'); b.output(ir, 'IR'); b.output(phase('Phase'), 'Phase');
      for (const name of ['A', 'B', 'Z', 'Out', 'Halt', 'Fault']) b.output(data(name), name);
      b.output(b.pin(ram, 'q'), 'Memory');
    }
  } else throw new Error(`No architecture reference circuit for lesson ${id}`);
  if (id === 38 || id === 44) layoutMachine(b.graph, id);
  return { levelId: id, revision: 0, ...b.graph };
}
