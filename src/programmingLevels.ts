// 第 45–56 关（编程应用）：接口复用第 44 关整机，mode='program'。
// expected/expectedOutputs 只是占位；判题完全由 programmingRunner 消费 ProgramCase 的数学结果。
import type { Level } from './levels';
import { architectureLevels } from './architectureLevels';

const machine = architectureLevels.find(level => level.id === 44)!;
type Lesson = [title: string, caption: string, goal: string, formula: string, hints: string[]];
const lessons: Lesson[] = [
  ['第一个汇编程序', '用三条指令控制计算机', '输出 42，且执行 HLT 正常停止。', 'OUT = 42', ['MOVI A, 42 把立即数写入 A。', 'OUT 会记录当前 A，每次执行都产生一条输出事件。', '最后写 HLT；空 ROM 会一直执行 NOP。']],
  ['字节运算与溢出', '用程序观察模 256 运算', '计算 250+13−5，输出八位结果 2，然后正常停止。', '(250 + 13 − 5) mod 256 = 2', ['MOVI B 设置另一个运算数。', 'ADD 和 SUB 把结果写回 A，并更新零标志 Z。', '字节溢出保留低八位：263 会变成 7。']],
  ['内存搬运', '读写独立的 RAM 单元', '将 RAM[240] 复制到 RAM[242]，输出原字节，然后停止。目的单元初值与原字节不同。', 'RAM[242] ← RAM[240]；OUT = RAM[240]', ['LOAD 240 将该内存字节读入 A。', 'STORE 242 将 A 写入目的单元，A 保持。', '判题同时检查输出和 RAM[242]；只输出不能完成搬运。']],
  ['倒计时循环', '用跳转重复执行', '从 RAM[240] 读取 n，依次输出 n、n−1、…、0，然后停止。', 'OUT 序列 = [n, n−1, …, 0]', ['给重复部分写标签，再用 JMP 跳回。', '每轮输出后检查 Z；n=0 也要输出一次。', 'MOVI B, 1 与 SUB 可以递减 A。']],
  ['条件分支', '用零标志决定路径', '输入 RAM[240] 为零时输出 0，其余字节输出 1，然后停止。', 'OUT = (n = 0 ? 0 : 1)', ['LOAD 与 MOVI A 会更新 Z。', 'JZ label 只在 Z=1 时跳转。', '两个分支最终都需要恰好一次 OUT 和正常停止。']],
  ['两数相加', '从内存读取动态输入', '输出 RAM[240]+RAM[241] 的模 256 结果，然后停止。', 'OUT = (a + b) mod 256', ['LOAD 只能写 A，MOVI B 只能写立即数。', '可在 RAM[244] 及更高地址保存计数与累计结果。', '用循环把第二个加数次数的 1 加到第一个加数上。']],
  ['常数乘法', '把乘三展开为加法', '输出 3×RAM[240] 的模 256 结果，然后停止。', 'OUT = 3n mod 256', ['乘三可以理解为三份 n 的和。', '每轮对累计结果加三，循环 n 次也是合法算法。', '输入 86 时结果回绕到 2。']],
  ['累加求和', '嵌套循环与中间状态', '输出 1+2+…+n 的模 256 结果，n 来自 RAM[240]；n=0 时输出 0。', 'OUT = n(n+1)/2 mod 256', ['一个计数器记录正在累加的数，另一个计数器实现动态加法。', '将计数器与累计值放进不同 RAM 单元。', '先判断零值，再递减，避免把 0 回绕到 255。']],
  ['奇偶判断', '把问题化为两个终点', '输出 RAM[240] 的奇偶性：偶数输出 0，奇数输出 1，然后停止。', 'OUT = n mod 2', ['当前 ISA 没有按位 AND 指令；可以反复减二。', '在减法前检测 0，减去一次 1 后再检测是否到零。', '每轮减两次 1，分别在原值为 0 或 1 时退出。']],
  ['四格求和', '重复使用同一个算法', '输出 RAM[240]、RAM[241]、RAM[242]、RAM[243] 四个字节之和的模 256 结果。', 'OUT = (M[240]+M[241]+M[242]+M[243]) mod 256', ['直接寻址意味着 LOAD 的地址写在程序中。', '为四个地址分别重复一次累计过程。', '四组输入独立变化，不能遗漏任何单元；最后只输出一次。']],
  ['斐波那契', '迭代更新两个相邻状态', '输出 F(n) mod 256，n 来自 RAM[240]，F(0)=0、F(1)=1。', 'F(n+2) = F(n+1) + F(n)', ['分别保存前一项、当前项和剩余轮数。', '更新当前项之前，先保存其旧值供下一轮使用。', 'n=0 与 n=1 需要正确处理；F(14)=377，字节结果是121。']],
  ['两数相乘', '从硬件走到完整算法', '输出 RAM[240]×RAM[241] 的模 256 结果，然后正常停止。', 'OUT = ab mod 256', ['乘法是多次累加，每次累加还可用加一循环实现。', '为外层次数、内层次数和累计结果分配不同 RAM 单元。', '零乘数应直接结束；模256回绕也是正确结果的一部分。']],
];

export const programmingLevels: Level[] = lessons.map(([title, caption, goal, formula, hints], index) => ({
  id: 45 + index, title, caption, goal, formula, chapter: 7,
  inputs: [...machine.inputs], inputPorts: machine.inputPorts.map(port => ({ ...port })),
  outputPorts: machine.outputPorts.map(port => ({ ...port })), allowed: [...machine.allowed],
  hints, mode: 'program', defaultProgram: [],
  // Program judging consumes mathematical ProgramCase outputs, never these register placeholders.
  expectedOutputs: () => Object.fromEntries(machine.outputPorts.map(port => [port.id, 0])),
}));
