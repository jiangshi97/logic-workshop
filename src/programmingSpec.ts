// 第 45–56 关的数学测试用例与参考汇编程序。
// ProgramCase 的期望输出/内存全部是数学计算结果，独立于任何参考执行；参考源仅供试玩与对照。
// 关卡编写 API（levelSpec）编译编程关时会登记用例到注册表，这里优先查询注册表再回退到旧 switch。
import { programCaseRegistry, programSourceRegistry } from './levelSpec';

export interface ProgramCase {
  id: string;
  label: string;
  memory: Record<number, number>;
  expectedOutput: number[];
  maxCycles: number;
  expectedMemory?: Record<number, number>;
}

const boundaries = [0, 1, 2, 3, 7, 8, 15, 16, 85, 86, 127, 128, 254, 255];
const range = (last: number): number[] => Array.from({ length: last + 1 }, (_, n) => n);
const fibonacci = (n: number): number => {
  let previous = 0, current = 1;
  for (let k = 0; k < n; k++) [previous, current] = [current, previous + current];
  return previous % 256;
};

/** Expected values are mathematical results, independent of any reference execution. */
/** 生成某关全部公开用例：输入写入 RAM 240 起，期望输出为完整 OUT 序列；maxCycles 是周期预算。 */
export function programmingCases(id: number): ProgramCase[] {
  const registered = programCaseRegistry.get(id);
  // 注册表数据来自 JSON 编译的共享对象，逐次深拷贝以保持与旧 switch 相同的“每次新建”语义。
  if (registered) return structuredClone(registered);
  const result: ProgramCase[] = [];
  const add = (values: number[], output: number[], maxCycles: number, expectedMemory?: Record<number, number>, extraMemory: Record<number, number> = {}) => {
    result.push({ id: `program-${id}-${result.length + 1}`,
      label: values.length ? values.map((value, index) => `RAM[${240 + index}]=${value}`).join('，') : '无输入',
      memory: { ...Object.fromEntries(values.map((value, index) => [240 + index, value])), ...extraMemory },
      expectedOutput: output, maxCycles, ...(expectedMemory ? { expectedMemory } : {}) });
  };
  switch (id) {
    case 45: add([], [42], 90); break;
    case 46: add([], [(250 + 13 - 5) % 256], 90); break;
    case 47:
      for (const n of range(255)) add([n], [n], 90, { 242: n }, { 242: (n + 1) % 256 });
      break;
    case 48:
      for (const n of [...range(10), 16]) add([n], range(n).reverse(), 30 * (n + 1) + 90);
      break;
    case 49:
      for (const n of boundaries) add([n], [n === 0 ? 0 : 1], 90);
      break;
    case 50:
      for (const [a, b] of [[0, 0], [0, 255], [255, 0], [1, 1], [255, 1], [1, 255], [128, 128], [127, 128], [254, 2], [85, 86], [13, 42], [42, 13]])
        add([a, b], [(a + b) % 256], 35 * (Math.max(a, b) + 1) + 90);
      break;
    case 51:
      for (const n of boundaries) add([n], [(3 * n) % 256], 40 * (n + 1) + 90);
      break;
    case 52:
      for (const n of [...range(8), 22, 23, 31]) add([n], [(n * (n + 1) / 2) % 256], 35 * (n * (n + 1) / 2 + n + 1) + 90);
      break;
    case 53:
      for (const n of boundaries) add([n], [n % 2], 20 * (n + 1) + 90);
      break;
    case 54:
      for (const values of [[0, 0, 0, 0], [1, 2, 3, 4], [255, 1, 255, 1], [255, 255, 255, 255], [0, 0, 0, 255], [128, 0, 128, 0], [13, 42, 7, 86], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]])
        add(values, [values.reduce((sum, value) => sum + value, 0) % 256], 32 * (values.reduce((sum, value) => sum + value, 0) + 1) + 180);
      break;
    case 55:
      for (const n of [...range(10), 14]) add([n], [fibonacci(n)], 12000);
      break;
    case 56: {
      const pairs = [...range(8).map(n => [n, n]), [0, 255], [255, 0], [1, 255], [255, 1], [2, 3], [3, 2], [4, 7], [7, 4], [8, 3], [3, 8], [16, 16], [20, 20]];
      for (const [a, b] of pairs) add([a, b], [(a * b) % 256], 40 * (a * b + a + b + 1) + 180);
      break;
    }
    default: throw new Error('编程关卡不存在。');
  }
  return result;
}

const sources: Record<number, string> = {
  45: `; 把立即数送到输出端口，然后停止
MOVI A, 42
OUT
HLT`,
  46: `MOVI A, 250
MOVI B, 13
ADD
MOVI B, 5
SUB
OUT
HLT`,
  47: `LOAD 240
STORE 242
OUT
HLT`,
  48: `LOAD 240
MOVI B, 1
loop: OUT
JZ done
SUB
JMP loop
done: HLT`,
  49: `LOAD 240
JZ zero
MOVI A, 1
zero: OUT
HLT`,
  50: `; 244 保存第二个加数，245 保存累计结果
LOAD 240
STORE 245
LOAD 241
STORE 244
MOVI B, 1
loop: LOAD 244
JZ done
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop
done: LOAD 245
OUT
HLT`,
  51: `LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
loop: LOAD 244
JZ done
SUB
STORE 244
LOAD 245
ADD
ADD
ADD
STORE 245
JMP loop
done: LOAD 245
OUT
HLT`,
  52: `; 外层从 n 倒数，内层将当前计数加到累计值
LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
outer: LOAD 244
JZ done
STORE 246
inner: LOAD 246
JZ next
SUB
STORE 246
LOAD 245
ADD
STORE 245
JMP inner
next: LOAD 244
SUB
STORE 244
JMP outer
done: LOAD 245
OUT
HLT`,
  53: `; 每轮减两次一，在零和一处分别退出
LOAD 240
MOVI B, 1
loop: JZ even
SUB
JZ odd
SUB
JMP loop
even: MOVI A, 0
OUT
HLT
odd: MOVI A, 1
OUT
HLT`,
  55: `; 244=前一项，245=当前项，246=剩余轮数
LOAD 240
JZ zero
MOVI B, 1
SUB
STORE 246
MOVI A, 0
STORE 244
MOVI A, 1
STORE 245
outer: LOAD 246
JZ done
SUB
STORE 246
LOAD 245
STORE 247
inner: LOAD 244
JZ next
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP inner
next: LOAD 247
STORE 244
JMP outer
done: LOAD 245
OUT
HLT
zero: OUT
HLT`,
  56: `; 每轮把乘数累加一次，内层用加一实现动态加法
LOAD 240
STORE 244
MOVI A, 0
STORE 245
MOVI B, 1
outer: LOAD 244
JZ done
SUB
STORE 244
LOAD 241
STORE 246
inner: LOAD 246
JZ outer
SUB
STORE 246
LOAD 245
ADD
STORE 245
JMP inner
done: LOAD 245
OUT
HLT`,
};

// Direct addressing has no indirect LOAD; use one labelled loop per input cell.
sources[54] = `MOVI A, 0
STORE 245
MOVI B, 1
${[240, 241, 242, 243].map((address, index) => `LOAD ${address}
STORE 244
loop${index}: LOAD 244
JZ next${index}
SUB
STORE 244
LOAD 245
ADD
STORE 245
JMP loop${index}
next${index}: NOP`).join('\n')}
LOAD 245
OUT
HLT`;

/** 第 45–56 关的参考汇编源（关卡 id → 源码），供示例存档与文档对照。 */
export function programmingReferenceSource(id: number): string {
  const registered = programSourceRegistry.get(id);
  if (registered !== undefined) return registered;
  const source = sources[id];
  if (source === undefined) throw new Error('编程关卡不存在。');
  return source;
}
