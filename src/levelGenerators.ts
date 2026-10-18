// 命名场景/用例生成器：JSON 关卡以 `"generator": "名字"` 引用，编译期在这里展开穷举判题数据。
// JSON 因此保持人可编写的小体积（文案 + 引用），回绕、同沿读写旧值等海量帧由本文件的参考状态机生成；
// 期望值仍来自独立数学模型（temporalOracle / architectureOracle），不经任何电路或仿真器。
// 手写小场景的新关卡不需要生成器——直接在 JSON 里写 steps 即可（见 docs/level-authoring.md）。
import type { Inputs, Outputs, Port } from './contracts';
import type { ScenarioSpec } from './levelSpec';
import { architectureOracle, architecturePrograms, encodeInstruction } from './architectureSpec';

export interface GeneratorContext { id: number; inputPorts: Port[]; outputPorts: Port[]; }
export type ScenarioGenerator = (context: GeneratorContext) => ScenarioSpec[];
export type CaseGenerator = (context: GeneratorContext) => Inputs[];

/** 第 21–32 关的独立算术参考状态机：保持、复位优先、同沿读写旧值、回绕全部在此定义。 */
function temporalOracle(id: number) {
  let q = 0, firstStage = 0;
  const memory = Array(id === 30 ? 2 : 4).fill(0) as number[];
  return (inputs: Inputs, tick: boolean): Outputs => {
    if (tick) {
      if (inputs.R === 1) { q = 0; firstStage = 0; memory.fill(0); }
      else if (id === 21 || id === 22) q = inputs.D;
      else if ((id === 23 || id === 24) && inputs.E) q = inputs.D;
      else if (id === 25 && inputs.T) q = 1 - q;
      else if ((id === 26 || id === 27) && inputs.E) q = (q + (inputs.Down ? 15 : 1)) % 16;
      else if (id === 28 && inputs.E) q = (q * 2 + inputs.In) % 16;
      else if (id === 29 && inputs.E) { q = firstStage; firstStage = inputs.D; }
      else if (id >= 30) {
        // Read captures the old cell even when this same edge overwrites it.
        if (id === 32 && inputs.Read) q = memory[inputs.Addr];
        if (inputs.W) memory[inputs.Addr] = inputs.D;
      }
    }
    return id === 32 ? { Memory: memory[inputs.Addr], Out: q }
      : id >= 30 ? { Q: memory[inputs.Addr] } : { Q: q };
  };
}

/** 生成第 21–32 关测试场景：每类关卡一组（或多组）步骤序列，期望值由 temporalOracle 同步计算。 */
function temporalScenarios({ id, inputPorts }: GeneratorContext): ScenarioSpec[] {
  const result: ScenarioSpec[] = [];
  const defaults = Object.fromEntries(inputPorts.map(p => [p.id, 0]));
  const step = (inputs: Inputs, tick = true): { inputs: Inputs; tick: boolean } => ({ inputs: { ...defaults, ...inputs }, tick });
  const add = (label: string, operations: { inputs: Inputs; tick: boolean }[]) => {
    const calculate = temporalOracle(id);
    result.push({ label,
      steps: operations.map(({ inputs, tick }) => ({ inputs, tick, expected: calculate(inputs, tick) })) });
  };
  const on = { E: 1, W: 1, Read: 1 };
  if (id <= 25) {
    const max = id === 24 ? 256 : 2;
    const data = id === 25 ? 'T' : 'D';
    // Each data value is observed without an edge, captured, repeated, and held with enable off.
    const ops = [step({}, false)];
    for (let value = 0; value < max; value++) {
      ops.push(step({ [data]: value, ...on }, false), step({ [data]: value, ...on }),
        step({ [data]: value, ...on }), step({ [data]: max - 1 - value, E: 0, T: id === 25 ? 0 : value }));
    }
    add('数据改变、重复采样与暂停保持', ops);
    if (id !== 21) {
      add('同步复位与使能优先级', [step({ [data]: max - 1, ...on }),
        step({ [data]: max - 1, ...on, R: 1 }, false), step({ [data]: max - 1, ...on, R: 1 }),
        step({ [data]: max - 1, ...on }), step({ [data]: max - 1, E: 0, R: 1 }),
        step({ [data]: max - 1, ...on }), step({ [data]: 0, E: 0 }, false)]);
    }
  } else if (id === 26 || id === 27) {
    for (const down of id === 27 ? [0, 1] : [0]) {
      const ops = [step({}, false), step({ E: 1, Down: down, R: 1 })];
      for (let count = 0; count < 34; count++) ops.push(step({ E: 1, Down: down }),
        step({ E: 1, Down: 1 - down }, false), step({ E: 0, Down: 1 - down }));
      ops.push(step({ E: 0, R: 1 }, false), step({ E: 0, R: 1 }), step({ E: 1, Down: down, R: 1 }));
      add(down ? '递减下溢、暂停与复位' : '递增溢出、暂停与复位', ops);
    }
    if (id === 27) add('每个状态切换方向', Array.from({ length: 16 }, (_, value) => [
      ...Array.from({ length: value }, () => step({ E: 1 })), step({ E: 1, Down: 1 }),
      step({ E: 1, Down: 0 }), step({ R: 1 }),
    ]).flat());
  } else if (id === 28) {
    for (let pattern = 0; pattern < 16; pattern++) {
      const ops = [step({ E: 1, In: 1, R: 1 })];
      for (let bit = 3; bit >= 0; bit--) {
        const In = (pattern >> bit) & 1;
        ops.push(step({ In, E: 1 }, false), step({ In, E: 1 }), step({ In: 1 - In, E: 0 }));
      }
      ops.push(step({ In: 1, E: 1 }), step({ In: 0, E: 1 }), step({ In: 1, E: 0, R: 1 }));
      add(`移入四位模式 ${pattern.toString(2).padStart(4, '0')}`, ops);
    }
  } else if (id === 29) {
    const ops = [step({}, false)];
    for (let D = 0; D < 16; D++) ops.push(step({ D, E: 1 }, false), step({ D, E: 1 }),
      step({ D: 15 - D, E: 0 }), step({ D, E: 1 }));
    ops.push(step({ D: 15, E: 1 }), step({ D: 7, E: 1, R: 1 }, false),
      step({ D: 7, E: 1, R: 1 }), step({ D: 3, E: 1 }), step({ D: 4, E: 1 }),
      step({ D: 9, E: 0, R: 1 }), step({ D: 5, E: 1 }), step({ D: 6, E: 1 }));
    add('两级旧值采样、重复数据、暂停与同时清零', ops);
  } else {
    const size = id === 30 ? 2 : 4;
    for (let Addr = 0; Addr < size; Addr++) for (let D = 0; D < 16; D++) {
      const ops: { inputs: Inputs; tick: boolean }[] = [step({}, false)];
      for (let cell = 0; cell < size; cell++) ops.push(step({ Addr: cell, D: (cell * 3 + 5) % 16, W: 1 }));
      const readAll = () => { for (let cell = 0; cell < size; cell++) ops.push(step({ Addr: cell, D: 15 - D }, false)); };
      readAll();
      ops.push(step({ Addr, D, W: 1, Read: 1 }, false), step({ Addr, D, W: 1, Read: 1 }));
      readAll();
      ops.push(step({ Addr, D: 15 - D, W: 0, Read: 0 }));
      readAll();
      if (id === 32) ops.push(step({ Addr, Read: 1 }), step({ Addr, D, W: 1, Read: 1 }),
        step({ Addr: (Addr + 1) % size, Read: 0 }), step({ Addr: (Addr + 1) % size, Read: 1 }));
      ops.push(step({ Addr, D: 15, W: 1, Read: 1, R: 1 }, false),
        step({ Addr, D: 15, W: 1, Read: 1, R: 1 }));
      readAll();
      ops.push(step({ Addr, D, W: 1 }), step({ Addr, W: 0, Read: 0, R: 1 }));
      readAll();
      add(`地址 ${Addr} 写入 ${D}：单元隔离、组合读取与复位`, ops);
    }
  }
  // Inputs must match the public interface exactly, even when shared generators use extra controls.
  for (const sequence of result) for (const row of sequence.steps)
    row.inputs = Object.fromEntries(inputPorts.map(p => [p.id, row.inputs[p.id]]));
  return result;
}

/** 生成第 35–44 关测试场景；第 44 关逐个运行 architecturePrograms 中的程序并穿插暂停/复位。 */
function architectureScenarios({ id, inputPorts }: GeneratorContext): ScenarioSpec[] {
  const result: ScenarioSpec[] = [];
  const defaults = Object.fromEntries(inputPorts.map(p => [p.id, 0]));
  const step = (inputs: Inputs = {}, tick = true): { inputs: Inputs; tick: boolean } => ({
    inputs: Object.fromEntries(inputPorts.map(p => [p.id, inputs[p.id] ?? defaults[p.id]])), tick,
  });
  const add = (label: string, operations: { inputs: Inputs; tick: boolean }[], program?: number[]) => {
    const calculate = architectureOracle(id, program);
    result.push({ id: `architecture-${id}-${result.length + 1}`, label,
      ...(program ? { program: [...program] } : {}),
      steps: operations.map(({ inputs, tick }) => ({ inputs, tick, expected: calculate(inputs, tick) })) });
  };
  if (id === 35) {
    const ops = [step({}, false)];
    for (let D = 0; D < 256; D++) {
      for (const [WA, WB] of [[1, 0], [0, 1], [1, 1]]) ops.push(step({ D, WA, WB }, false), step({ D, WA, WB }));
      ops.push(step({ D: 255 - D }));
    }
    ops.push(step({ D: 255, WA: 1, WB: 1, R: 1 }, false), step({ D: 255, WA: 1, WB: 1, R: 1 }), step({ D: 171, WA: 1 }), step({ R: 1 }));
    add('独立写、同时写、全字节数据与同步复位', ops);
  } else if (id === 36 || id === 38) {
    const ops = [step({}, false), step({ R: 1 })];
    for (let count = 0; count < 260; count++) ops.push(step({ E: 1 }));
    for (let Target = 0; Target < 256; Target++) ops.push(step({ E: 1, Jump: 1, Target }, false), step({ E: 1, Jump: 1, Target }), step({ E: 0, Jump: 1, Target: 255 - Target }));
    ops.push(step({ E: 1, Jump: 1, Target: 255, R: 1 }, false), step({ E: 1, Jump: 1, Target: 255, R: 1 }), step({ E: 1 }));
    add('顺序回绕、全部跳转地址、暂停与复位', ops, id === 38 ? architecturePrograms[0].words : undefined);
    if (id === 38) add('ROM 每个地址的独立字、旧 PC 取指', ops, Array.from({ length: 256 }, (_, address) => ((address * 251) ^ 0xa55a) & 65535));
  } else if (id === 39) {
    const ops = [step({}, false)];
    for (let cycle = 0; cycle < 18; cycle++) ops.push(step({ E: 1 }, false), step({ E: 1 }), step({ E: 0 }), step({ E: 1, Stop: 1 }));
    ops.push(step({ E: 1, Stop: 1, R: 1 }, false), step({ E: 1, Stop: 1, R: 1 }), step({ E: 1 }));
    add('三阶段循环、两种暂停与复位优先', ops);
  } else if (id === 41) {
    const ops = [step({}, false)];
    for (let Addr = 0; Addr < 256; Addr++) ops.push(step({ Addr, D: (Addr * 73 + 19) & 255, W: 1 }, false), step({ Addr, D: (Addr * 73 + 19) & 255, W: 1 }));
    for (let Addr = 255; Addr >= 0; Addr--) ops.push(step({ Addr }, false), step({ Addr, D: 255, W: 0 }));
    ops.push(step({ Addr: 255, D: 99, W: 1, R: 1 }, false), step({ Addr: 255, D: 99, W: 1, R: 1 }));
    for (let Addr = 0; Addr < 256; Addr++) ops.push(step({ Addr }, false));
    ops.push(step({ Addr: 128, D: 255, W: 1 }), step({ R: 1 }), step({ Addr: 128 }, false));
    add('全部地址隔离、组合读、写保持与整片同步清零', ops);
  } else if (id === 42) {
    const ops = [step({}, false)];
    for (let D = 0; D < 256; D++) ops.push(step({ D, Write: 1 }, false), step({ D, Write: 1 }), step({ D: 255 - D }));
    ops.push(step({ D: 255, Write: 1, R: 1 }, false), step({ D: 255, Write: 1, R: 1 }), step({ D: 128, Write: 1 }), step({ R: 1 }));
    add('全字节输出、无沿与未写入保持、同步复位', ops);
  } else if (id === 43) {
    const ops = [step({}, false)];
    const instructions = [0x700a, 0x1000, 0x1101, 0x700a, 0x10ff, 0x2000, 0x700a, 0x3000, 0x8000, 0x50ff, 0x40ff, 0x8000, 0x6000, 0x0000];
    for (const Instruction of instructions) ops.push(step({ Instruction, Data: 85, Exec: 1 }, false), step({ Instruction, Data: 85, Exec: 1 }), step({ Instruction: 0x1063, Data: 255, Exec: 0 }));
    for (let D = 0; D < 256; D++) ops.push(step({ Instruction: encodeInstruction(1, 0, D), Exec: 1 }), step({ Instruction: encodeInstruction(1, 1, 255 - D), Exec: 1 }));
    ops.push(step({ Instruction: 0x9000, Exec: 1 }), step({ Instruction: 0x1063, Exec: 1 }), step({ Instruction: 0x8000, Exec: 1 }), step({ Instruction: 0x1063, Exec: 1, R: 1 }, false), step({ Instruction: 0x1063, Exec: 1, R: 1 }), step({ Instruction: 0x8000, Exec: 1 }));
    add('所有合法指令、Z 保持与更新、暂停、停止和复位', ops);
    for (const Instruction of [0xa000, 0x1200, 0x2001, 0x3100, 0x41ff, 0x51ff, 0x61ff, 0x71ff, 0x8001, 0x9001, 0x0100]) {
      add(`非法编码 0x${Instruction.toString(16)} 无副作用并锁定`, [step({}, false), step({ Instruction: 0x1025, Exec: 1 }), step({ Instruction: 0x1107, Exec: 1 }), step({ Instruction, Data: 255, Exec: 1 }, false), step({ Instruction, Data: 255, Exec: 1 }), step({ Instruction: 0x1000, Exec: 1 }), step({ Instruction: 0x50ff, Exec: 1 }), step({ Instruction: 0x9000, Exec: 1 }), step({ Instruction: 0x1063, Exec: 1, R: 1 }, false), step({ Instruction: 0x1063, Exec: 1, R: 1 }), step({ Instruction: 0x1000, Exec: 1 })]);
    }
  } else if (id === 44) {
    for (const program of architecturePrograms) {
      const ops = [step({}, false), step({ E: 1, R: 1 })];
      const cycles = program.id === 'pc-wrap' ? 30 : (program.words.length + 3) * 3;
      for (let cycle = 0; cycle < cycles; cycle++) {
        ops.push(step({ E: 1 }));
        if (cycle < 6 || cycle % 9 === 0) ops.push(step({ E: 1 }, false), step({ E: 0 }));
      }
      // Exercise reset while stopped, E=0 reset priority, and a fresh fetch from unchanged ROM.
      ops.push(step({ E: 0, R: 1 }, false), step({ E: 0, R: 1 }), step({ E: 1 }), step({ E: 0 }), step({ E: 1 }), step({ E: 1 }));
      add(program.label, ops, program.words);
    }
  }
  return result;
}

/** 第 33/34 关公开用例：每个 A 配边界伙伴集与全部运算选择。 */
function aluCaseList({ id }: GeneratorContext): Inputs[] {
  const control = id === 33 ? 'Sub' : 'Op';
  const count = id === 33 ? 2 : 4;
  const cases: Inputs[] = [];
  for (let A = 0; A < 256; A++) {
    const partners = new Set([0, 1, 127, 128, 254, 255, A, 255 - A, (A * 73) & 255]);
    for (const B of partners) for (let op = 0; op < count; op++) cases.push({ A, B, [control]: op });
  }
  return cases;
}

/** 第 40 关公开用例：全部合法/非法指令字 × Z × Phase。 */
function controllerCaseList(): Inputs[] {
  const words = new Set<number>();
  for (let opcode = 0; opcode < 16; opcode++) for (let param = 0; param < 16; param++)
    for (const imm of [0, 1, 127, 128, 255]) words.add(encodeInstruction(opcode, param, imm));
  // Each reserved immediate bit is independently exercised, including values absent from the boundary set.
  for (const opcode of [0, 2, 3, 8, 9]) for (let bit = 0; bit < 8; bit++) words.add(encodeInstruction(opcode, 0, 1 << bit));
  return [...words].flatMap(Instruction => [0, 1].flatMap(Z => [0, 1, 2, 3].map(Phase => ({ Instruction, Z, Phase }))));
}

export const scenarioGenerators = new Map<string, ScenarioGenerator>([
  ['temporal', temporalScenarios],
  ['architecture', architectureScenarios],
]);
export const caseGenerators = new Map<string, CaseGenerator>([
  ['alu-cases', aluCaseList],
  ['controller-cases', controllerCaseList],
]);
