// 机器注册表：绑定解析、草稿识别与按机器筛选指令的汇编器行为。
import { expect, it } from 'vitest';
import { assemble, disassemble } from '../src/assembler';
import { canonicalMachineLibrary, machines, machineByKey, machineForLevel, machineKeyOf, programmingMachine, validateProgrammingMachine } from '../src/machines';
import { levels } from '../src/levels';

it('registers the level-44 machine and resolves every program level binding', () => {
  expect(machines.map(m => m.key)).toEqual(['computer-44']);
  for (const level of levels.filter(level => level.mode === 'program')) {
    expect(machineForLevel(level.id).key).toBe('computer-44');
    expect(machineKeyOf(programmingMachine(level.id))?.key).toBe('computer-44');
  }
  expect(machineByKey('computer-44').instructions).toHaveLength(10);
  expect(machineByKey(undefined)).toBe(machines[0]);
  expect(() => machineByKey('computer-99')).toThrow(/未知计算机/);
});

it('recognizes machine drafts but rejects modified wiring', () => {
  const library = canonicalMachineLibrary();
  const circuit = programmingMachine(45);
  expect(validateProgrammingMachine(circuit, library)).toEqual([]);
  const tampered = { ...circuit, wires: circuit.wires.slice(0, -1) };
  expect(validateProgrammingMachine(tampered, library)[0]).toMatch(/固定机器/);
  expect(machineKeyOf(tampered)).toBeUndefined();
});

it('filters assembly and disassembly by machine instruction subsets', () => {
  const stub = { name: '测试机', instructions: ['NOP', 'HLT'] };
  expect(assemble('NOP\nHLT', stub).words).toEqual([0x0000, 0x9000]);
  expect(() => assemble('JMP 0', stub)).toThrow(/测试机不支持指令 JMP/);
  expect(disassemble([0x0000, 0x9000], stub)).toBe('NOP\nHLT');
  expect(() => disassemble([0x6000], stub)).toThrow(/超出测试机支持的指令集/);
});
