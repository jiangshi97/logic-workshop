// 第 33–44 关（计算机架构）：从八位加减器到整机 CPU。
// 组合关（33/34/37/40）提供 expected 与公开用例集；时序关（35/36/38/39/41–44）由 architectureOracle 生成场景。
import type { GateType, Inputs, Outputs, Port, SimulationStep, TestSequence } from './contracts';
import type { Level } from './levels';
import { architectureOracle, architecturePrograms, byteALU, decodeInstruction, encodeInstruction, instructionControl } from './architectureSpec';

type Specs = [string, number][];
const tools: GateType[] = ['NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'SPLIT', 'JOIN', 'CONST', 'DFF'];
const ports = (specs: Specs): Port[] => specs.map(([id, bits]) => ({ id, label: id, bits }));
/** 架构关卡工厂：给 expected 即为组合关（用公开用例集），否则为时序关（走 scenarios 场景）。 */
function lesson(id: number, title: string, caption: string, goal: string, formula: string,
  inputSpecs: Specs, outputSpecs: Specs, hints: string[], rewardName: string,
  expected?: (i: Inputs) => Outputs, cases?: () => Inputs[]): Level {
  const inputPorts = ports(inputSpecs), outputPorts = ports(outputSpecs);
  const expectedOutputs = expected ?? (i => architectureOracle(id)(i, true));
  return { id, title, caption, goal, formula, chapter: 6,
    inputs: inputPorts.map(p => p.id), inputPorts, outputPorts,
    allowed: [...tools, ...(id >= 38 ? ['ROM' as GateType] : []), ...(id >= 41 ? ['RAM' as GateType] : [])],
    hints, rewardName, expectedOutputs,
    ...(expected ? { cases } : { mode: 'sequential' as const, sequences: () => scenarios(id, inputPorts) }),
    ...([38, 44].includes(id) ? { defaultProgram: [...architecturePrograms[0].words] } : {}),
  };
}

function aluCases(control: string, count: number): Inputs[] {
  const cases: Inputs[] = [];
  for (let A = 0; A < 256; A++) {
    const partners = new Set([0, 1, 127, 128, 254, 255, A, 255 - A, (A * 73) & 255]);
    for (const B of partners) for (let op = 0; op < count; op++) cases.push({ A, B, [control]: op });
  }
  return cases;
}

function controllerCases(): Inputs[] {
  const words = new Set<number>();
  for (let opcode = 0; opcode < 16; opcode++) for (let param = 0; param < 16; param++)
    for (const imm of [0, 1, 127, 128, 255]) words.add(encodeInstruction(opcode, param, imm));
  // Each reserved immediate bit is independently exercised, including values absent from the boundary set.
  for (const opcode of [0, 2, 3, 8, 9]) for (let bit = 0; bit < 8; bit++) words.add(encodeInstruction(opcode, 0, 1 << bit));
  return [...words].flatMap(Instruction => [0, 1].flatMap(Z => [0, 1, 2, 3].map(Phase => ({ Instruction, Z, Phase }))));
}

export const architectureLevels: Level[] = [
  lesson(33, '八位加减器', '把补码扩展为字节运算', 'Sub=0 加法，Sub=1 减法。Y 保留低八位；加法只输出 Carry，减法只输出 Borrow，Z 检测零。',
    'Y=(A±B) mod 256；Z=(Y=0)', [['A', 8], ['B', 8], ['Sub', 1]], [['Y', 8], ['Carry', 1], ['Borrow', 1], ['Z', 1]],
    ['Sub 同时控制 B 的逐位反转与初始进位。', '减法 Borrow 是最高进位的反转，加法 Carry 是最高进位。', '用 Sub 把 Carry 与 Borrow 分别门控；将 Y 的各位 OR 后反转得到 Z。'], 'AddSubtract8',
    i => byteALU(i.A, i.B, i.Sub), () => aluCases('Sub', 2)),
  lesson(34, '八位 ALU', '选择四种运算', 'Op=0 加、1 减、2 AND、3 XOR。逻辑运算时 Carry 与 Borrow 为 0；Z 始终反映 Y。',
    'Y=ALU(A,B,Op)', [['A', 8], ['B', 8], ['Op', 2]], [['Y', 8], ['Carry', 1], ['Borrow', 1], ['Z', 1]],
    ['并行计算加减、AND 与 XOR 的结果。', 'Op 的两位控制结果选择器。', '只有加法激活 Carry，只有减法激活 Borrow；Z 从最终选出的 Y 计算。'], 'ALU8',
    i => byteALU(i.A, i.B, i.Op), () => aluCases('Op', 4)),
  lesson(35, '双寄存器组', '同一条数据总线，两份独立状态', '沿上 WA 写 A，WB 写 B，可同时写入 D；R 沿上优先清零两个寄存器。',
    '沿上 A←WA?D:A；B←WB?D:B；R 优先', [['D', 8], ['WA', 1], ['WB', 1], ['R', 1]], [['A', 8], ['B', 8]],
    ['复用两个八位使能寄存器。', '两个寄存器共享 D 和 R，分别接 WA 与 WB。', '两路使能独立，任何一路保持时都需要选择自己的旧值。'], 'RegisterPair8'),
  lesson(36, '程序计数器', '顺序前进与跳转', '沿上 R 清零；否则 E=1 时 Jump 选择 Target 或 PC+1；E=0 保持，255 加一回到 0。',
    '沿上 PC←R?0:E?(Jump?Target:PC+1):PC', [['E', 1], ['Jump', 1], ['Target', 8], ['R', 1]], [['PC', 8]],
    ['先计算旧 PC 加一。', 'Jump 选择顺序地址或 Target，E 再选择新地址或保持。', '八位寄存器保存 PC；同步复位优先于使能与跳转。'], 'ProgramCounter8'),
  lesson(37, '指令格式', '从十六位指令中读出含义', '分离 Opcode、Param、Imm，并校验操作码与保留位。MOVI 参数只允许 0/1；地址指令参数必须 0；其他合法指令参数和立即数均为 0。',
    'Instruction=Opcode×4096+Param×256+Imm', [['Instruction', 16]], [['Opcode', 4], ['Param', 4], ['Imm', 8], ['Valid', 1]],
    ['低八位是立即数或地址；中间四位是参数；高四位是操作码。', '0–9 是合法操作码，10–15 非法。', 'MOVI(1) 参数≤1；LOAD/STORE/JMP/JZ(4–7) 参数=0；NOP/ADD/SUB/OUT/HLT 的参数和立即数都为0。'], 'InstructionDecoder',
    i => { const d = decodeInstruction(i.Instruction); return { Opcode: d.opcode, Param: d.param, Imm: d.imm, Valid: d.valid ? 1 : 0 }; },
    () => Array.from({ length: 65536 }, (_, Instruction) => ({ Instruction }))),
  lesson(38, '取指电路', '沿上先取旧地址的指令', 'ROM 保存程序。使能沿上 IR 记住旧 PC 对应的指令，再让 PC 顺序前进或跳转。R 优先清零 PC 和 IR，ROM 保留。',
    '沿上 IR←ROM[旧PC]；PC←Jump?Target:PC+1（E=1）', [['E', 1], ['Jump', 1], ['Target', 8], ['R', 1]], [['PC', 8], ['IR', 16]],
    ['ROM 的 addr 接 PC，q 接 IR 的数据输入。', 'IR 与 PC 同步采样，所以 IR 取得沿发生前地址的数据。', 'ROM 节点 ID 使用 program；PC 和 IR 共享 E 与 R，复位不修改程序。'], 'InstructionFetch'),
  lesson(39, '三阶段时序', '取指、译码、执行', '使能沿上 Phase 按 0→1→2→0 循环。Stop 或 E=0 保持；R 优先清零；Phase=2 时 Execute=1。',
    '沿上 Phase←R?0:(E∧¬Stop)?(Phase+1) mod 3:Phase', [['E', 1], ['Stop', 1], ['R', 1]], [['Phase', 2], ['Execute', 1]],
    ['两位状态足够表示三个阶段，状态3不参与正常循环。', '从当前阶段译码出下一阶段。', 'E 与 NOT(Stop) 控制寄存器写入；Execute 直接检测 Phase 等于2。'], 'ThreePhaseClock'),
  lesson(40, '指令控制器', '把指令变成控制信号', '根据当前指令 Instruction、零标志 Z 和阶段 Phase 生成控制信号。Phase=0、1、2 分别表示取指、译码、执行，合法指令只有在 Phase=2 时产生对应控制信号。WA/WB 分别是寄存器 A/B 写使能；ALUOp 选择 ALU 运算（00 加法、01 减法）；MemWrite/MemRead 分别是 RAM 写入和读取使能；Jump 是 PC 跳转使能；OutWrite 是输出寄存器写使能；Halt 是停机信号；Invalid 表示指令编码非法且不受 Phase 影响。JZ 还需要 Z=1。',
    '执行控制=Valid∧(Phase=2)∧指令译码', [['Instruction', 16], ['Z', 1], ['Phase', 2]],
    [['WA', 1], ['WB', 1], ['ALUOp', 2], ['MemWrite', 1], ['MemRead', 1], ['Jump', 1], ['OutWrite', 1], ['Halt', 1], ['Invalid', 1]],
    ['先复用指令格式校验，再检测执行阶段。', '合法指令在 Phase=2 时才打开对应控制信号：MOVI 根据 Param 决定写 A 或 B；ADD/SUB/LOAD 都会写 A；LOAD/STORE 分别控制 RAM 读取和写入；OUT/HLT 控制输出和停机。', 'ALUOp 只有 SUB 时为01；JMP 总是跳转，JZ 还要与 Z 相与；其他阶段的执行控制都应为0。'], 'InstructionController', instructionControl, controllerCases),
  lesson(41, '字节存储器', '扩展到完整地址空间', 'Addr 选择 256 格字节。Q 组合读取当前地址；W 沿上写入 D；R 沿上清空全部 RAM，优先于写入。',
    'Q=M[Addr]；沿上 M[Addr]←D（W=1）；R 清空', [['Addr', 8], ['D', 8], ['W', 1], ['R', 1]], [['Q', 8]],
    ['RAM 的 addr、d、we、rst 分别接 Addr、D、W、R。', '改变 Addr 后可以立即读另一格，写入仍等待时钟沿。', '确认高地址与低地址相互独立；同步复位清空所有格。'], 'Memory256x8'),
  lesson(42, '输出端口', '让程序的结果留下来', 'Write=1 的沿把 D 保存到 Out；其余时候保持；R 沿上优先清零。',
    '沿上 Out←R?0:Write?D:Out', [['D', 8], ['Write', 1], ['R', 1]], [['Out', 8]],
    ['输出端口也是一个八位使能寄存器。', 'Write 控制新数据与旧 Out 的选择。', '把 R 接同步复位；输入 D 改变时不能直接改变 Out。'], 'OutputPort8'),
  lesson(43, '指令数据通路', '寄存器与控制器一起执行', 'Exec 沿上执行当前指令，Data 提供 LOAD 数据。MOVI A/ADD/SUB/LOAD 更新 Z；HLT 或非法指令锁定状态到复位。跳转与访存信号组合输出，Target/Addr 始终是 Imm，Store 始终是 A。',
    '沿上A←WA?(MOVI→Imm;ADD/SUB→ALU(A,B,ALUOp);LOAD→Data):A;\nB←WB?Imm:B;\nZ←WA?（写入A的值=0）:Z;\nOut←OutWrite?A:Out;\n满足Exec∧(HLT∨Invalid)后Halt=1，直到R清零;\n满足Exec∧Invalid后Fault=1，直到R清零;\nTarget=Addr=Imm;Store=A', [['Instruction', 16], ['Data', 8], ['Exec', 1], ['R', 1]],
    [['A', 8], ['B', 8], ['Z', 1], ['Out', 8], ['Halt', 1], ['Fault', 1], ['Jump', 1], ['Target', 8], ['Addr', 8], ['Store', 8], ['MemWrite', 1], ['MemRead', 1]],
    ['组合控制用 Exec∧¬Halt 门控；HLT 与非法编码用寄存器记住停止状态。', 'Z 是寄存器：只随写 A 更新，初始为0；OUT 保存旧 A。', 'Target/Addr 从指令低八位直接输出，Store 直接接 A；R 优先清除 A/B/Z/Out/Halt/Fault。'], 'InstructionDatapath'),
  lesson(44, '我的八位计算机', '让真实电路执行程序', '用 ROM、RAM 和门级数据通路组成三阶段 CPU。阶段0取指，1译码，2执行并更新 PC。E=0 冻结；R 清空机器与 RAM；HLT/非法保持 PC 与阶段2。Memory 组合显示 IR 低八位地址对应的 RAM 值。',
    'Fetch→Decode→Execute；程序驱动真实电路', [['E', 1], ['R', 1]],
    [['PC', 8], ['IR', 16], ['Phase', 2], ['A', 8], ['B', 8], ['Z', 1], ['Out', 8], ['Halt', 1], ['Fault', 1], ['Memory', 8]],
    ['ROM 节点 ID=program。IR 在阶段0捕获，阶段2用 IR 的控制信号执行。', '普通指令完成后 PC 加1，JMP/JZ 选择目标；HLT/非法将机器停在阶段2（设置 Halt，PC 不更新）。', 'E 门控所有状态与 RAM 写入；R 沿上清状态/RAM但保留 ROM，机器观察面板显示真实电路的状态。'], 'Computer8'),
];

/** 生成第 35–44 关测试场景；第 44 关逐个运行 architecturePrograms 中的程序并穿插暂停/复位。 */
function scenarios(id: number, inputPorts: Port[]): TestSequence[] {
  const result: TestSequence[] = [];
  const defaults = Object.fromEntries(inputPorts.map(p => [p.id, 0]));
  const step = (inputs: Inputs = {}, tick = true): SimulationStep => ({
    inputs: Object.fromEntries(inputPorts.map(p => [p.id, inputs[p.id] ?? defaults[p.id]])), tick,
  });
  const add = (label: string, operations: SimulationStep[], program?: number[]) => {
    const calculate = architectureOracle(id, program);
    result.push({ id: `architecture-${id}-${result.length + 1}`, label,
      ...(program ? { program: [...program] } : {}),
      steps: operations.map(({ inputs, tick }) => ({ inputs, tick, expectedOutputs: calculate(inputs, tick) })) });
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
