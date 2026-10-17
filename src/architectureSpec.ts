// 指令集规格（ISA 唯一权威）与架构阶段参考模型。
// 16 位指令布局：Opcode[15:12] · Param[11:8] · Imm[7:0]，共 10 条指令；不满足保留位约束的编码为非法指令。
// architectureOracle 是独立参考 CPU（三阶段状态机），期望值全部由此产生，不引用任何电路。
import type { Inputs, Outputs } from './contracts';

const instructionNames = ['NOP', 'MOVI', 'ADD', 'SUB', 'LOAD', 'STORE', 'JMP', 'JZ', 'OUT', 'HLT'];

export const instructionSet = [
  { opcode: 0, name: 'NOP', param: '必须为 0', immediate: '必须为 0', effect: '不执行操作' },
  { opcode: 1, name: 'MOVI', param: '0=A，1=B', immediate: '8 位立即数', effect: '将立即数写入 A 或 B' },
  { opcode: 2, name: 'ADD', param: '必须为 0', immediate: '必须为 0', effect: 'A ← A + B' },
  { opcode: 3, name: 'SUB', param: '必须为 0', immediate: '必须为 0', effect: 'A ← A - B' },
  { opcode: 4, name: 'LOAD', param: '必须为 0', immediate: '8 位地址', effect: 'A ← RAM[地址]' },
  { opcode: 5, name: 'STORE', param: '必须为 0', immediate: '8 位地址', effect: 'RAM[地址] ← A' },
  { opcode: 6, name: 'JMP', param: '必须为 0', immediate: '8 位地址', effect: 'PC ← 地址' },
  { opcode: 7, name: 'JZ', param: '必须为 0', immediate: '8 位地址', effect: 'Z=1 时 PC ← 地址' },
  { opcode: 8, name: 'OUT', param: '必须为 0', immediate: '必须为 0', effect: 'Out ← A' },
  { opcode: 9, name: 'HLT', param: '必须为 0', immediate: '必须为 0', effect: '停机' },
] as const;

/** 编码一条指令字：高 4 位操作码、中 4 位参数、低 8 位立即数。 */
export function encodeInstruction(op: number, param = 0, imm = 0): number {
  return ((op & 15) << 12) | ((param & 15) << 8) | (imm & 255);
}

/** 译码并校验：MOVI 参数只允许 0/1，访存/跳转参数必须为 0，无立即数指令的 Imm 也必须为 0。 */
export function decodeInstruction(word: number): { opcode: number; param: number; imm: number; valid: boolean; name: string } {
  const opcode = (word >>> 12) & 15, param = (word >>> 8) & 15, imm = word & 255;
  const valid = opcode === 1 ? param <= 1
    : opcode >= 4 && opcode <= 7 ? param === 0
    : [0, 2, 3, 8, 9].includes(opcode) && param === 0 && imm === 0;
  return { opcode, param, imm, valid, name: instructionNames[opcode] ?? 'INVALID' };
}

/** Programs contain only ROM data: the simulator still executes the player's graph. */
export const architecturePrograms: { id: string; label: string; words: number[] }[] = [
  { id: 'demonstration', label: '加法、存储、读取与输出', words: [0x1007, 0x1105, 0x2000, 0x50f0, 0x1000, 0x40f0, 0x8000, 0x9000] },
  { id: 'arithmetic', label: '加法溢出与减法回绕', words: [0x10ff, 0x1101, 0x2000, 0x8000, 0x3000, 0x8000, 0x9000] },
  { id: 'conditional', label: '初始非零标志与条件跳转两条分支', words: [0x7005, 0x1000, 0x7005, 0x1063, 0x8000, 0x102a, 0x8000, 0x9000] },
  { id: 'high-memory', label: 'RAM 高地址与单元隔离', words: [0x10a5, 0x50ff, 0x105a, 0x5080, 0x1000, 0x40ff, 0x8000, 0x4080, 0x8000, 0x9000] },
  { id: 'pc-wrap', label: 'ROM 255 与 PC 从 255 回绕到 0', words: Array.from({ length: 256 }, (_, address) => address === 0 ? 0x60fe : address === 254 ? 0x104d : address === 255 ? 0x8000 : 0) },
  { id: 'invalid-opcode', label: '非法操作码停止且无副作用', words: [0x1017, 0xa000, 0x1063, 0x8000] },
  { id: 'reserved-immediate', label: '算术保留位非法', words: [0x1017, 0x2001, 0x1063, 0x8000] },
  { id: 'reserved-register', label: '非法寄存器参数', words: [0x1017, 0x1200, 0x1063, 0x8000] },
  { id: 'reserved-address-param', label: '访存保留参数非法', words: [0x1017, 0x51ff, 0x1063, 0x8000] },
  { id: 'reset-memory', label: '先读零值、停止后复位清空 RAM', words: [0x40ff, 0x8000, 0x10a5, 0x50ff, 0x9000] },
];

/** 参考字节 ALU：op=0 加、1 减、2 AND、3 XOR，附带进位/借位与零标志。 */
export function byteALU(A: number, B: number, op: number): Outputs {
  const Y = op === 0 ? (A + B) & 255 : op === 1 ? (A - B) & 255 : op === 2 ? A & B : A ^ B;
  return { Y, Carry: op === 0 && A + B > 255 ? 1 : 0, Borrow: op === 1 && A < B ? 1 : 0, Z: Y === 0 ? 1 : 0 };
}

/** 第 40 关指令控制器的数学期望：合法指令仅在 Phase=2 产生对应控制信号。 */
export function instructionControl(i: Inputs): Outputs {
  const decoded = decodeInstruction(i.Instruction);
  const active = decoded.valid && i.Phase === 2;
  const op = decoded.opcode;
  return {
    WA: active && (op === 1 && decoded.param === 0 || [2, 3, 4].includes(op)) ? 1 : 0,
    WB: active && op === 1 && decoded.param === 1 ? 1 : 0,
    ALUOp: active && op === 3 ? 1 : 0,
    MemWrite: active && op === 5 ? 1 : 0,
    MemRead: active && op === 4 ? 1 : 0,
    Jump: active && (op === 6 || op === 7 && i.Z === 1) ? 1 : 0,
    OutWrite: active && op === 8 ? 1 : 0,
    Halt: active && op === 9 ? 1 : 0,
    Invalid: decoded.valid ? 0 : 1,
  };
}

/** Independent specification state. Never imports circuits, netlists, or the simulator. */
export function architectureOracle(id: number, program = architecturePrograms[0].words): (inputs: Inputs, tick: boolean) => Outputs {
  let A = 0, B = 0, Z = 0, Out = 0, PC = 0, IR = 0, Phase = 0, Halt = 0, Fault = 0;
  const memory = Array<number>(256).fill(0);
  const execute = (instruction: number, data: number): { jump: boolean; address: number } => {
    const { opcode, param, imm, valid } = decodeInstruction(instruction);
    if (!valid) { Halt = 1; Fault = 1; return { jump: false, address: imm }; }
    switch (opcode) {
      case 1: if (param === 1) B = imm; else { A = imm; Z = A === 0 ? 1 : 0; } break;
      case 2: A = (A + B) & 255; Z = A === 0 ? 1 : 0; break;
      case 3: A = (A - B) & 255; Z = A === 0 ? 1 : 0; break;
      case 4: A = data; Z = A === 0 ? 1 : 0; break;
      case 8: Out = A; break;
      case 9: Halt = 1; break;
    }
    return { jump: opcode === 6 || opcode === 7 && Z === 1, address: imm };
  };
  return (i, tick): Outputs => {
    if (tick) {
      if (i.R === 1) {
        A = B = Z = Out = PC = IR = Phase = Halt = Fault = 0;
        memory.fill(0);
      } else if (id === 35) { if (i.WA) A = i.D; if (i.WB) B = i.D; }
      else if (id === 36 && i.E) PC = i.Jump ? i.Target : (PC + 1) & 255;
      else if (id === 38 && i.E) { IR = program[PC] ?? 0; PC = i.Jump ? i.Target : (PC + 1) & 255; }
      else if (id === 39 && i.E && !i.Stop) Phase = (Phase + 1) % 3;
      else if (id === 41 && i.W) memory[i.Addr] = i.D;
      else if (id === 42 && i.Write) Out = i.D;
      else if (id === 43 && i.Exec && !Halt) execute(i.Instruction, i.Data);
      else if (id === 44 && i.E && !Halt) {
        if (Phase === 0) { IR = program[PC] ?? 0; Phase = 1; }
        else if (Phase === 1) Phase = 2;
        else {
          const decoded = decodeInstruction(IR);
          const oldA = A;
          const branch = execute(IR, memory[decoded.imm]);
          if (!Halt) {
            if (decoded.opcode === 5) memory[decoded.imm] = oldA;
            PC = branch.jump ? branch.address : (PC + 1) & 255;
            Phase = 0;
          }
        }
      }
    }
    if (id === 35) return { A, B };
    if (id === 36) return { PC };
    if (id === 38) return { PC, IR };
    if (id === 39) return { Phase, Execute: Phase === 2 ? 1 : 0 };
    if (id === 41) return { Q: memory[i.Addr] };
    if (id === 42) return { Out };
    if (id === 43) {
      const { opcode, imm, valid } = decodeInstruction(i.Instruction);
      const active = i.Exec === 1 && !Halt && valid;
      return { A, B, Z, Out, Halt, Fault, Jump: active && (opcode === 6 || opcode === 7 && Z === 1) ? 1 : 0,
        Target: imm, Addr: imm, Store: A, MemWrite: active && opcode === 5 ? 1 : 0, MemRead: active && opcode === 4 ? 1 : 0 };
    }
    return { PC, IR, Phase, A, B, Z, Out, Halt, Fault, Memory: memory[IR & 255] };
  };
}
