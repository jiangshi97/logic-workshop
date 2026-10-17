// 汇编器与反汇编器：两遍扫描（先收集标签，再生成指令字）；纯文本转换，不涉及机器状态。
import { decodeInstruction, encodeInstruction } from './architectureSpec';

/** 汇编清单中的一行：地址、指令字、源行号与源文本。 */
export interface AssemblyListing {
  address: number;
  word: number;
  line: number;
  text: string;
}

export interface AssemblyResult {
  words: number[];
  listing: AssemblyListing[];
  labels: Record<string, number>;
}

const opcodes: Record<string, number> = { NOP: 0, MOVI: 1, ADD: 2, SUB: 3, LOAD: 4, STORE: 5, JMP: 6, JZ: 7, OUT: 8, HLT: 9 };
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
function fail(line: number, message: string): never { throw new Error(`第 ${line} 行：${message}`); }

/** Two passes resolve labels; no simulator or machine state participates. */
export function assemble(source: string): AssemblyResult {
  if (source.length > 32000) fail(1, '源程序超过 32,000 字符。');
  const labels = new Map<string, number>();
  const instructions: { code: string; line: number; text: string }[] = [];
  source.split(/\r\n|\n|\r/).forEach((text, index) => {
    const line = index + 1;
    let code = text.split(';')[0].trim();
    if (!code) return;
    if (code.includes(':')) {
      const colon = code.indexOf(':');
      const name = code.slice(0, colon).trim();
      if (!identifier.test(name)) fail(line, '标签必须是字母或下划线开头的标识符。');
      const key = name.toLowerCase();
      if (labels.has(key)) fail(line, `标签 ${name} 重复定义。`);
      if (instructions.length >= 256) fail(line, '标签地址超出 0–255。');
      labels.set(key, instructions.length);
      code = code.slice(colon + 1).trim();
      if (!code) return;
    }
    if (instructions.length >= 256) fail(line, '程序最多容纳 256 条指令。');
    instructions.push({ code, line, text: text.trim() });
  });
  const byte = (token: string, line: number): number => {
    if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(token)) fail(line, `字节 ${token} 必须为十进制或 0x 十六进制。`);
    const value = Number(token);
    if (!Number.isInteger(value) || value < 0 || value > 255) fail(line, '字节或地址超出 0–255。');
    return value;
  };
  const listing = instructions.map(({ code, line, text }, address): AssemblyListing => {
    const match = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(code);
    if (!match) fail(line, '指令格式错误。');
    const name = match[1].toUpperCase();
    const opcode = opcodes[name];
    if (opcode === undefined) fail(line, `未知指令 ${name}。`);
    const operand = match[2]?.trim() ?? '';
    let param = 0, imm = 0;
    if (name === 'MOVI') {
      const args = /^([AB])\s*,\s*(\S+)$/i.exec(operand);
      if (!args) fail(line, 'MOVI 格式为 MOVI A, byte 或 MOVI B, byte。');
      param = args[1].toUpperCase() === 'B' ? 1 : 0;
      imm = byte(args[2], line);
    } else if (opcode >= 4 && opcode <= 7) {
      if (!operand || /[\s,]/.test(operand)) fail(line, `${name} 需要一个地址。`);
      if ((opcode === 6 || opcode === 7) && identifier.test(operand)) {
        const target = labels.get(operand.toLowerCase());
        if (target === undefined) fail(line, `未知标签 ${operand}。`);
        imm = target;
      } else imm = byte(operand, line);
    } else if (operand) fail(line, `${name} 不接受参数。`);
    return { address, word: encodeInstruction(opcode, param, imm), line, text };
  });
  return { words: listing.map(row => row.word), listing, labels: Object.fromEntries(labels) };
}

/** 反汇编：用于把已保存的 ROM 字恢复成可编辑源码；遇到非法指令字则抛错。 */
export function disassemble(words: number[]): string {
  if (words.length > 256) throw new Error('地址 256：程序最多容纳 256 个字。');
  return words.map((word, address) => {
    const decoded = decodeInstruction(word);
    if (!Number.isInteger(word) || word < 0 || word > 65535 || !decoded.valid) {
      throw new Error(`地址 ${address}：非法指令字 ${String(word)}。`);
    }
    if (decoded.opcode === 1) return `MOVI ${decoded.param === 1 ? 'B' : 'A'}, ${decoded.imm}`;
    if (decoded.opcode >= 4 && decoded.opcode <= 7) return `${decoded.name} ${decoded.imm}`;
    return decoded.name;
  }).join('\n');
}
