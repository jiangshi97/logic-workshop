import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace, parseWorkspace, saveWorkspace } from '../src/storage';
import { architectureLibrary } from '../src/architectureCircuits';
import { referenceCircuit } from './fixtures';

afterEach(() => vi.unstubAllGlobals());
const rawWorkspace = () => JSON.parse(JSON.stringify(createWorkspace()));
function legacy(version: number) {
  const raw = rawWorkspace(), max = [0, 4, 20, 32, 44][version];
  raw.version = version;
  raw.circuits = Object.fromEntries(Object.entries(raw.circuits).filter(([id]) => +id <= max));
  raw.inputs = Object.fromEntries(Object.entries(raw.inputs).filter(([id]) => +id <= max));
  raw.library = version === 4 ? architectureLibrary() : {};
  return raw;
}

it('starts v5 with twelve complete fixed CPUs, empty ROMs and enabled inputs', () => {
  const workspace = createWorkspace();
  expect(workspace.version).toBe(6);
  expect(Object.keys(workspace.circuits)).toHaveLength(56);
  for (let id = 45; id <= 56; id++) {
    expect(workspace.circuits[id].nodes.find(n => n.type === 'ROM')?.words).toEqual([]);
    expect(workspace.circuits[id].wires.length).toBeGreaterThan(0);
    expect(workspace.inputs[id]).toEqual({ E: 1, R: 0 });
  }
  expect(Object.keys(workspace.library).length).toBeGreaterThan(0);
  expect(parseWorkspace(JSON.stringify(workspace))).toEqual(workspace);
});

it.each([1, 2, 3, 4])('adds complete programming drafts and dependencies when migrating v%i', version => {
  const raw = legacy(version), restored = parseWorkspace(JSON.stringify(raw), { verifyProofs: false });
  expect(restored.version).toBe(6);
  expect(Object.keys(restored.circuits)).toHaveLength(56);
  expect(restored.circuits[1]).toEqual(raw.circuits[1]);
  expect(parseWorkspace(JSON.stringify(restored), { verifyProofs: false })).toEqual(restored);
  expect(restored.circuits[45].nodes.find(n => n.type === 'ROM')?.words).toEqual([]);
});

it('reverifies the continuous chain of forty-four old proofs after migration', () => {
  const raw = legacy(4);
  raw.proofs = Object.fromEntries(Array.from({ length: 44 }, (_, i) => [i + 1, referenceCircuit(i + 1)]));
  raw.currentLevel = 44;
  const restored = parseWorkspace(JSON.stringify(raw));
  expect(restored.proofs).toEqual(raw.proofs);
  expect(restored.currentLevel).toBe(44);
  raw.proofs[21] = raw.circuits[21];
  expect(Object.keys(parseWorkspace(JSON.stringify(raw)).proofs)).toHaveLength(20);
}, 120_000);

it('keeps v4 bounded at 44 even after curriculum expansion', () => {
  const raw = legacy(4);
  raw.circuits[45] = raw.circuits[44];
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/关卡/);
});

it('requires every v5 draft and refuses to repair a missing dependency silently', () => {
  const raw = rawWorkspace();
  delete raw.circuits[56];
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow();
  const missing = rawWorkspace();
  missing.library = {};
  expect(() => parseWorkspace(JSON.stringify(missing))).toThrow(/依赖|组件|固定|机器/);
});

it('rejects altered CPU wiring and altered canonical dependency definitions', () => {
  const raw = rawWorkspace();
  raw.circuits[45].wires.pop();
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/固定|机器|CPU/);
  const dependency = rawWorkspace();
  const definition = Object.values(dependency.library).find((d: any) => d.graph.nodes.some((n: any) => n.type === 'CONST')) as any;
  const node = definition.graph.nodes.find((n: any) => n.type === 'CONST');
  node.value = node.value ? 0 : 1;
  expect(() => parseWorkspace(JSON.stringify(dependency))).toThrow(/固定|机器|依赖|CPU/);
});

it('rejects conflicting legacy canonical versions instead of overwriting them', () => {
  const raw = legacy(4), definition = Object.values(raw.library).find((d: any) => d.graph.nodes.some((n: any) => n.type === 'CONST')) as any;
  const node = definition.graph.nodes.find((n: any) => n.type === 'CONST');
  node.value = node.value ? 0 : 1;
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/固定|机器|依赖|CPU/);
});

it('round-trips assembly source while excluding all debugger and runtime fields', () => {
  const raw = rawWorkspace(), rom = raw.circuits[38].nodes.find((n: any) => n.type === 'ROM');
  rom.words = [0x102a, 0x8000, 0x9000];
  rom.programSource = 'MOVI A, 42\nOUT\nHLT';
  raw.program = { outputs: [42], memory: [1], instructions: 3 };
  raw.breakpoints = [0]; raw.selectedCase = 'case'; raw.undo = [1];
  raw.circuits[38].state = { cycle: 9 }; rom.runtimeValue = 42;
  let saved = '';
  vi.stubGlobal('localStorage', { setItem: (_key: string, text: string) => { saved = text; } });
  saveWorkspace(raw);
  const parsed = parseWorkspace(saved), exported = JSON.parse(saved);
  expect(parsed.circuits[38].nodes.find(n => n.type === 'ROM')?.programSource).toBe(rom.programSource);
  for (const key of ['program', 'breakpoints', 'selectedCase', 'undo']) expect(exported).not.toHaveProperty(key);
  expect(exported.circuits[38]).not.toHaveProperty('state');
  expect(exported.circuits[38].nodes.find((n: any) => n.type === 'ROM')).not.toHaveProperty('runtimeValue');
});

it.each(['MOVI A, 43\nOUT\nHLT', 'UNKNOWN', 42, ' '.repeat(32001)])('rejects invalid, mismatched or oversized assembly source', source => {
  const raw = rawWorkspace(), rom = raw.circuits[38].nodes.find((n: any) => n.type === 'ROM');
  rom.words = [0x102a, 0x8000, 0x9000]; rom.programSource = source;
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/源|汇编|程序|行/);
});

it('rejects assembly source on a non-ROM node', () => {
  const raw = rawWorkspace(); raw.circuits[1].nodes[0].programSource = '';
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/ROM/);
});
