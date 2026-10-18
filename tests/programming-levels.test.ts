import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assembler';
import { chapters, getLevel, testInputs, testSequences } from '../src/levels';
import { programmingCases, programmingReferenceSource } from '../src/programmingSpec';
import { programmingMachine, programmingMachineLibrary } from '../src/programmingMachine';
import { judge } from '../src/simulator';

describe('programming challenge specifications', () => {
  it('accepts addition that accumulates either operand on the actual CPU', () => {
    const circuit = programmingMachine(50);
    const source = programmingReferenceSource(50).replace(/LOAD (240|241)\b/g,
      (_, address: string) => `LOAD ${address === '240' ? 241 : 240}`);
    circuit.nodes.find(node => node.id === 'program')!.words = assemble(source).words;
    const result = judge(circuit, programmingMachineLibrary());
    expect(result.error).toBeUndefined();
    expect(result.passed, JSON.stringify(result.failure)).toBe(true);
  }, 60000);

  it('keeps the machine ports and uses application cases instead of register traces', () => {
    expect(chapters[6]).toBe('编程应用');
    for (let id = 45; id <= 56; id++) {
      const level = getLevel(id);
      expect(level.mode).toBe('program');
      expect(level.chapter).toBe(7);
      expect(level.inputPorts).toEqual(getLevel(44).inputPorts);
      expect(level.outputPorts).toEqual(getLevel(44).outputPorts);
      expect(level.allowed).toEqual(getLevel(44).allowed);
      expect(level.defaultProgram ?? []).toEqual([]);
      expect(testInputs(id)).toEqual([]);
      expect(testSequences(id)).toEqual([]);
    }
  });

  it('defines byte copies for every input and requires their observable RAM write', () => {
    const cases = programmingCases(47);
    expect(cases).toHaveLength(256);
    for (let byte = 0; byte < 256; byte++) {
      expect(cases[byte].memory[240]).toBe(byte);
      expect(cases[byte].expectedOutput).toEqual([byte]);
      expect(cases[byte].expectedMemory).toEqual({ 242: byte });
      expect(cases[byte].memory[242]).not.toBe(byte);
    }
  });

  it('includes mathematical zero, overflow and ordered multi-OUT examples', () => {
    const find = (id: number, memory: Record<number, number>) => programmingCases(id).find(c => Object.entries(memory).every(([address, value]) => c.memory[Number(address)] === value))!;
    expect(programmingCases(45)[0].expectedOutput).toEqual([42]);
    expect(programmingCases(46)[0].expectedOutput).toEqual([2]);
    expect(find(48, { 240: 3 }).expectedOutput).toEqual([3, 2, 1, 0]);
    expect(find(48, { 240: 0 }).expectedOutput).toEqual([0]);
    expect(find(49, { 240: 0 }).expectedOutput).toEqual([0]);
    expect(find(49, { 240: 255 }).expectedOutput).toEqual([1]);
    expect(find(50, { 240: 255, 241: 1 }).expectedOutput).toEqual([0]);
    expect(find(51, { 240: 86 }).expectedOutput).toEqual([2]);
    expect(find(52, { 240: 23 }).expectedOutput).toEqual([20]);
    expect(find(53, { 240: 255 }).expectedOutput).toEqual([1]);
    expect(find(54, { 240: 255, 241: 1, 242: 255, 243: 1 }).expectedOutput).toEqual([0]);
    expect(find(55, { 240: 0 }).expectedOutput).toEqual([0]);
    expect(find(55, { 240: 10 }).expectedOutput).toEqual([55]);
    expect(find(55, { 240: 14 }).expectedOutput).toEqual([121]);
    expect(find(56, { 240: 16, 241: 16 }).expectedOutput).toEqual([0]);
  });

  it('returns deterministic, independent data and only finite legal reference programs', () => {
    for (let id = 45; id <= 56; id++) {
      const cases = programmingCases(id);
      expect(cases.length).toBeGreaterThan(0);
      expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
      expect(programmingCases(id)).toEqual(cases);
      for (const sample of cases) {
        expect(sample.maxCycles).toBeGreaterThan(0);
        expect(sample.maxCycles).toBeLessThanOrEqual(40000);
        for (const value of [...Object.values(sample.memory), ...sample.expectedOutput]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(256);
        }
      }
      const original = structuredClone(cases);
      cases[0].memory[240] = 123;
      cases[0].expectedOutput.push(123);
      expect(programmingCases(id)).toEqual(original);
      const program = assemble(programmingReferenceSource(id));
      expect(program.words.length).toBeGreaterThan(0);
      expect(program.words.length).toBeLessThanOrEqual(256);
      expect(program.words).toContain(0x9000);
    }
    expect(() => programmingCases(44)).toThrow();
    expect(() => programmingReferenceSource(57)).toThrow();
  });
});
