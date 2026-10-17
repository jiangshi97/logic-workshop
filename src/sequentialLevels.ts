// 第 21–32 关（状态与时间）：关卡定义 + 独立数学参考状态机 + 测试场景生成器。
// 场景（scenarios）按关卡类别覆盖保持、复位优先级、同沿读写旧值、回绕等时序细节。
import type { GateType, Inputs, Outputs, Port, SimulationStep, TestSequence } from './contracts';
import type { Level } from './levels';

type Specs = [string, number][];
const tools: GateType[] = ['NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'SPLIT', 'JOIN', 'CONST', 'DFF'];
const ports = (specs: Specs): Port[] => specs.map(([id, bits]) => ({ id, label: id, bits }));

/** Independent arithmetic specification. No circuit or simulator participates in expected values. */
function mathematicalMachine(id: number) {
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

/** 时序关卡工厂：expectedOutputs 仅用于兼容展示，真正判题始终走 sequences 场景。 */
function temporalLesson(id: number, title: string, caption: string, goal: string, formula: string,
  inputSpecs: Specs, outputSpecs: Specs, hints: string[], rewardName: string): Level {
  const inputPorts = ports(inputSpecs), outputPorts = ports(outputSpecs);
  // Compatibility only: one capture from cleared state. Temporal grading always uses sequences.
  const expectedOutputs = (inputs: Inputs) => mathematicalMachine(id)(inputs, true);
  return { id, title, caption, goal, formula, chapter: 5, mode: 'sequential',
    inputs: inputPorts.map(p => p.id), inputPorts, outputPorts, allowed: [...tools], hints, rewardName,
    expectedOutputs, sequences: () => scenarios(id, inputPorts),
  };
}

export const sequentialLevels: Level[] = [
  temporalLesson(21, '记住一个信号', '第一次跨越时间', '初始 Q=0。改变 D 时 Q 保持；每次时钟沿后 Q 记住当前 D。', '沿上 Q ← D；无沿保持', [['D', 1]], [['Q', 1]],
    ['DFF 是有记忆的元件，初始输出为 0。', 'd 接数据，rst 是同步复位，q 输出保存的值。', 'D 接 d，CONST 0 接 rst，q 接 Q；改变 D 后按单步观察。'], 'Register1'),
  temporalLesson(22, '同步复位', '用时钟清除状态', '沿上 R=1 时 Q 清零，否则 Q=D。改变 R 也要等到时钟沿才生效。', '沿上 Q ← R ? 0 : D', [['D', 1], ['R', 1]], [['Q', 1]],
    ['复位也遵守同一个时钟。', 'R 的优先级高于数据输入。', 'D 接 DFF.d，R 接 rst，q 接 Q；先写入 1 再测试复位。'], 'ResetRegister1'),
  temporalLesson(23, '使能寄存器', '选择写入或保持', '沿上 R=1 清零；否则 E=1 时写入 D，E=0 时保持。', '沿上 Q ← R ? 0 : E ? D : Q', [['D', 1], ['E', 1], ['R', 1]], [['Q', 1]],
    ['保持意味着把当前 q 再送回 d。', '用 E 在当前 q 与新数据 D 之间选择。', 'MUX(Q,D,E) 接 d，R 接 rst；复位优先于使能。'], 'EnabledRegister1'),
  temporalLesson(24, '八位寄存器', '保存完整字节', '保存 0–255 的八位数据；沿上复位优先，使能关闭时保持。', '沿上 Q8 ← R ? 0 : E ? D8 : Q8', [['D', 8], ['E', 1], ['R', 1]], [['Q', 8]],
    ['把上一关结构扩展为八位。', '八位 DFF 与数据通路的位宽要一致。', '八个选择器共享 E，JOIN 合成八位送 d；也可用八位逻辑门。'], 'Register8'),
  temporalLesson(25, '翻转开关', '状态参与运算', '沿上 R=1 清零；否则 T=1 翻转 Q，T=0 保持。', '沿上 Q ← R ? 0 : Q ⊕ T', [['T', 1], ['R', 1]], [['Q', 1]],
    ['XOR 与 0 运算保持，与 1 运算反转。', 'DFF 的 q 可以参加计算下一状态。', 'XOR(q,T) 接 d，R 接 rst。'], 'Toggle1'),
  temporalLesson(26, '四位计数器', '从记忆到累计', '沿上 R=1 清零；否则 E=1 时 Q 加 1，15 后回到 0。', '沿上 Q ← R ? 0 : E ? (Q+1) mod 16 : Q', [['E', 1], ['R', 1]], [['Q', 4]],
    ['用当前 Q 作为自增器输入。', '自增结果与当前 Q 由 E 选择。', '四位自增后接使能寄存器，R 清零；计数超过 15 会回绕。'], 'Counter4'),
  temporalLesson(27, '可逆计数器', '向前与向后', '使能时 Down=0 加 1，Down=1 减 1；0 减 1 得 15。沿上 R 优先清零。', '沿上 Q ← R ? 0 : E ? (Q ± 1) mod 16 : Q', [['E', 1], ['Down', 1], ['R', 1]], [['Q', 4]],
    ['分别计算当前 Q 的加一与减一。', 'Down 选择方向，E 决定是否保存新值。', '先选择加减结果，再用 E 选择保持或写入；R 接同步复位。'], 'UpDownCounter4'),
  temporalLesson(28, '串行移位', '一次进入一位', '沿上使能时把 Q 左移一位，In 写入最低位；最高位丢弃。复位优先。', '沿上 Q ← R ? 0 : E ? (2Q+In) mod 16 : Q', [['In', 1], ['E', 1], ['R', 1]], [['Q', 4]],
    ['拆开旧 Q 的四个位，改变连接的位置。', '新 bit0 接 In，新 bit1/2/3 接旧 bit0/1/2。', 'JOIN 合成移位结果，用 E 选择它或旧 Q，再接 DFF。'], 'Shift4'),
  temporalLesson(29, '两级流水', '同时采样旧状态', '两个四位寄存器共享 E 和 R。沿上第一级保存 D，第二级保存第一级的旧值，第二级输出 Q。', '沿上 Stage1 ← D；Q ← 旧 Stage1（E=1，R=0）', [['D', 4], ['E', 1], ['R', 1]], [['Q', 4]],
    ['一个沿上所有寄存器同时采样。', '第二级收到的是沿发生前第一级的值。', '串联两个使能寄存器，共享 E、R；关闭 E 时两个阶段都保持。'], 'Pipeline4'),
  temporalLesson(30, '两格存储器', '地址选择独立状态', 'Addr 选择两格四位存储单元。沿上 W=1 写选中格；Q 始终组合读取当前地址，R 沿上清空两格。', '沿上 M[Addr] ← D（W=1）；Q = M[Addr]', [['Addr', 1], ['D', 4], ['W', 1], ['R', 1]], [['Q', 4]],
    ['每格需要一个独立四位寄存器。', '写使能分别是 W∧¬Addr 与 W∧Addr。', '两个单元共享 D、R；读取用 Addr 控制四位 MUX。'], 'Memory2x4'),
  temporalLesson(31, '四格存储器', '地址译码与读取', '两位 Addr 选择四格四位存储单元；写入只改变被选中的格，切换地址立即改变 Q，复位清空全部格。', '沿上 M[Addr] ← D（W=1）；Q = M[Addr]', [['Addr', 2], ['D', 4], ['W', 1], ['R', 1]], [['Q', 4]],
    ['把 Addr 拆成两位并译码成四条选择线。', '每格的使能是 W 与本格选择线相与。', '四个寄存器保存数据，读取通过两层四位 MUX 选择。'], 'Memory4x4'),
  temporalLesson(32, '存储与数据通路', '沿上读取旧数据', 'Memory 组合读取当前格。沿上 Read=1 时 Out 保存沿前旧 Memory；同沿 W=1 可写新数据，但 Out 捕获旧值。R 优先清空全部状态。', '沿上 Out ← 旧 M[Addr]（Read=1）；M[Addr] ← D（W=1）', [['Addr', 2], ['D', 4], ['W', 1], ['Read', 1], ['R', 1]], [['Memory', 4], ['Out', 4]],
    ['Memory 是当前地址对应的组合输出。', '给 Memory 后面再接一个由 Read 控制的寄存器。', '所有寄存器共享时钟与 R；同一沿读写时 Out 得到写入前的值。'], 'MemoryDatapath4'),
];

/** 生成第 21–32 关测试场景：每类关卡一组（或多组）步骤序列，期望值由 mathematicalMachine 同步计算。 */
function scenarios(id: number, inputPorts: Port[]): TestSequence[] {
  const result: TestSequence[] = [];
  const defaults = Object.fromEntries(inputPorts.map(p => [p.id, 0]));
  const step = (inputs: Inputs, tick = true): SimulationStep => ({ inputs: { ...defaults, ...inputs }, tick });
  const add = (label: string, operations: SimulationStep[]) => {
    const calculate = mathematicalMachine(id);
    result.push({ id: `level-${id}-scenario-${result.length + 1}`, label,
      steps: operations.map(({ inputs, tick }) => ({ inputs, tick, expectedOutputs: calculate(inputs, tick) })) });
  };
  const on = { E: 1, W: 1, Read: 1 };
  if (id <= 25) {
    const max = id === 24 ? 256 : 2;
    const data = id === 25 ? 'T' : 'D';
    // Each data value is observed without an edge, captured, repeated, and held with enable off.
    const ops: SimulationStep[] = [step({}, false)];
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
      const ops: SimulationStep[] = [step({}, false), step({ E: 1, Down: down, R: 1 })];
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
      const ops: SimulationStep[] = [step({}, false)];
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
