import { describe, expect, it } from 'vitest';
import { compileExpression } from '../src/levelExpr';

const evalWith = (source: string, inputs: Record<string, number> = {}) => compileExpression(source)(inputs);

describe('expression literals and operators', () => {
  it('evaluates literals including hexadecimal', () => {
    expect(evalWith('42')).toBe(42);
    expect(evalWith('0x1f')).toBe(31);
    expect(evalWith('0X10')).toBe(16);
  });

  it('applies standard arithmetic precedence', () => {
    expect(evalWith('2 + 3 * 4')).toBe(14);
    expect(evalWith('(2 + 3) * 4')).toBe(20);
    expect(evalWith('7 - 2 - 1')).toBe(4);
    expect(evalWith('-3 + 10')).toBe(7);
  });

  it('uses floor division and mathematical modulo', () => {
    expect(evalWith('7 div 2')).toBe(3);
    expect(evalWith('-7 div 2')).toBe(-4);
    expect(evalWith('7 mod 5')).toBe(2);
    // 与除数同号：负被除数得到非负余数，等式 a = b*(a div b) + (a mod b) 恒成立。
    expect(evalWith('(3 - 10) mod 16')).toBe(9);
    expect(evalWith('(3 - 10) div 16')).toBe(-1);
    expect(evalWith('-3 mod 8')).toBe(5);
  });

  it('supports bitwise operators and unary not', () => {
    expect(evalWith('5 & 3')).toBe(1);
    expect(evalWith('5 | 3')).toBe(7);
    expect(evalWith('5 ^ 3')).toBe(6);
    expect(evalWith('1 << 4')).toBe(16);
    expect(evalWith('16 >> 2')).toBe(4);
    expect(evalWith('~0')).toBe(-1);
    expect(evalWith('~(5 & 3) & 7')).toBe(6);
  });

  it('returns zero or one from comparisons', () => {
    expect(evalWith('3 < 5')).toBe(1);
    expect(evalWith('5 <= 3')).toBe(0);
    expect(evalWith('4 = 4')).toBe(1);
    expect(evalWith('4 != 4')).toBe(0);
    expect(evalWith('2 + 3 >= 5')).toBe(1);
    expect(evalWith('A = 1 & B = 1', { A: 1, B: 0 })).toBe(0);
  });

  it('evaluates the conditional expression', () => {
    expect(evalWith('S ? B : A', { S: 1, A: 2, B: 7 })).toBe(7);
    expect(evalWith('S ? B : A', { S: 0, A: 2, B: 7 })).toBe(2);
    expect(evalWith('A < B ? A + B : A - B', { A: 9, B: 4 })).toBe(5);
  });

  it('resolves identifiers from the allowed list', () => {
    const fn = compileExpression('(A + B + Cin) div 2', ['A', 'B', 'Cin']);
    expect(fn({ A: 1, B: 1, Cin: 1 })).toBe(1);
    expect(fn({ A: 15, B: 15, Cin: 1 })).toBe(15);
  });
});

describe('expression rejection', () => {
  it('rejects identifiers outside the allowed list at compile time', () => {
    expect(() => compileExpression('A + Q', ['A'])).toThrow(/未声明的端口/);
  });

  it('rejects missing input values at evaluation time', () => {
    expect(() => evalWith('A + 1', { B: 2 })).toThrow(/缺少输入端口/);
  });

  it('rejects division and modulo by zero at evaluation time', () => {
    expect(() => evalWith('1 div 0')).toThrow(/除零/);
    expect(() => evalWith('5 mod 0')).toThrow(/取模/);
  });

  it('rejects malformed sources', () => {
    expect(() => compileExpression('')).toThrow();
    expect(() => compileExpression('   ')).toThrow();
    expect(() => compileExpression('A +')).toThrow(/意外结束/);
    expect(() => compileExpression('(A')).toThrow(/期待“\)”/);
    expect(() => compileExpression('A ? B')).toThrow(/期待“:”/);
    expect(() => compileExpression('1 2')).toThrow(/多余内容/);
    expect(() => compileExpression('A @ B')).toThrow(/无法识别的字符/);
    expect(() => compileExpression('$')).toThrow(/无法识别的字符/);
  });

  it('treats div and mod as reserved words rather than ports', () => {
    expect(() => compileExpression('div + 1', ['div'])).toThrow();
    expect(evalWith('10 mod 3')).toBe(1);
  });
});
