import { levels } from '../src/levels';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ComponentDefinition } from '../src/contracts';
import { connect, createCircuit } from '../src/model';
import { createWorkspace, parseWorkspace, saveWorkspace } from '../src/storage';

afterEach(() => vi.unstubAllGlobals());

function legacy32() {
  const workspace = createWorkspace();
  return { ...workspace, version: 3,
    circuits: Object.fromEntries(Object.entries(workspace.circuits).filter(([id]) => Number(id) <= 32)),
    inputs: Object.fromEntries(Object.entries(workspace.inputs).filter(([id]) => Number(id) <= 32)) };
}

function romDefinition(): ComponentDefinition {
  return { id: 'rom-bank', version: 1, name: '程序库', sourceLevel: 38, dependencies: [],
    inputs: [{ id: 'Addr', label: 'Addr', bits: 8 }], outputs: [{ id: 'Word', label: 'Word', bits: 16 }],
    graph: { nodes: [
      { id: 'Addr', label: 'Addr', type: 'INPUT', bits: 8, position: { x: 0, y: 0 } },
      { id: 'program', label: 'ROM', type: 'ROM', bits: 16, words: [0x10ff, 0x1101, 0xffff], position: { x: 100, y: 0 } },
      { id: 'Word', label: 'Word', type: 'OUTPUT', bits: 16, position: { x: 200, y: 0 } },
    ], wires: [
      { id: 'address', source: 'Addr', sourceHandle: 'out', target: 'program', targetHandle: 'addr' },
      { id: 'instruction', source: 'program', sourceHandle: 'q', target: 'Word', targetHandle: 'in' },
    ] } };
}

it('migrates v3 to fifty-six drafts while preserving proofs and saved input values', () => {
  const legacy = legacy32();
  legacy.currentLevel = 2;
  legacy.circuits[1] = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  legacy.proofs[1] = structuredClone(legacy.circuits[1]);
  legacy.inputs[24] = { D: 255, E: 1, R: 0 };
  const restored = parseWorkspace(JSON.stringify(legacy));
  expect(restored.version).toBe(6);
  expect(Object.keys(restored.circuits)).toHaveLength(levels.length);
  expect(restored.currentLevel).toBe(2);
  expect(restored.circuits[1]).toEqual(legacy.circuits[1]);
  expect(restored.proofs[1]).toEqual(legacy.proofs[1]);
  expect(restored.inputs[24]).toEqual({ D: 255, E: 1, R: 0 });
  expect(restored.circuits[33].wires).toEqual([]);
  expect(restored.circuits[44].wires).toEqual([]);
  expect(restored.library).toEqual(createWorkspace().library);
});

it('rejects architecture entries under a v3 version instead of silently accepting them', () => {
  const legacy = legacy32();
  legacy.circuits[33] = legacy.circuits[1];
  expect(() => parseWorkspace(JSON.stringify(legacy))).toThrow(/关卡/);
});

it('imports the historical v3 demonstration without rewriting its saved drafts', () => {
  const text = readFileSync(new URL('../docs/state-and-time-demo.json', import.meta.url), 'utf8');
  const original = JSON.parse(text);
  expect(original.version).toBe(3);
  const restored = parseWorkspace(text, { verifyProofs: false });
  expect(restored.version).toBe(6);
  expect(Object.keys(restored.circuits)).toHaveLength(levels.length);
  expect(restored.currentLevel).toBe(original.currentLevel);
  expect(restored.proofs).toEqual(original.proofs);
  expect(restored.library).toMatchObject(original.library);
  expect(restored.circuits[32]).toEqual(original.circuits[32]);
});

it.each([38, 44])('retains the editable program on the fixed ROM node in lesson %i', id => {
  const workspace = createWorkspace();
  workspace.circuits[id].nodes.find(node => node.id === 'program')!.words = [0x1007, 0x8000, 0x9000];
  const restored = parseWorkspace(JSON.stringify(workspace), { verifyProofs: false });
  expect(restored.circuits[id].nodes.find(node => node.id === 'program')!.words).toEqual([0x1007, 0x8000, 0x9000]);
});

it('retains ROM programs, sixteen-bit interfaces and nested immutable dependencies in v4', () => {
  const workspace = createWorkspace(), leaf = romDefinition();
  const outer: ComponentDefinition = { ...structuredClone(leaf), id: 'outer-bank', version: 2,
    dependencies: ['rom-bank@1'], graph: { nodes: [leaf.graph.nodes[0],
      { id: 'child', label: 'ROM child', type: 'COMPONENT', componentKey: 'rom-bank@1', position: { x: 100, y: 0 } },
      leaf.graph.nodes[2]], wires: [
      { id: 'address', source: 'Addr', sourceHandle: 'out', target: 'child', targetHandle: 'Addr' },
      { id: 'instruction', source: 'child', sourceHandle: 'Word', target: 'Word', targetHandle: 'in' },
    ] } };
  workspace.library = { ...workspace.library, 'rom-bank@1': leaf, 'outer-bank@2': outer };
  const raw = JSON.parse(JSON.stringify(workspace));
  raw.library['rom-bank@1'].graph.nodes[1].runtimeValue = 123;
  raw.state = { cycle: 19, registers: { cpu: 7 }, memories: { ram: [255] } };
  const restored = parseWorkspace(JSON.stringify(raw));
  expect(restored.library).toEqual(workspace.library);
  expect(restored.library['rom-bank@1'].graph.nodes[1].words).toEqual([0x10ff, 0x1101, 0xffff]);
  expect(restored).not.toHaveProperty('state');
  let saved = '';
  vi.stubGlobal('localStorage', { setItem: (_key: string, text: string) => { saved = text; } });
  saveWorkspace({ ...restored, state: raw.state } as typeof restored);
  expect(JSON.parse(saved).library['rom-bank@1'].graph.nodes[1].words).toEqual([0x10ff, 0x1101, 0xffff]);
  expect(JSON.parse(saved)).not.toHaveProperty('state');
});

it.each([[], Array(256).fill(65535)].map(words => ({ words })))('accepts a ROM program at its length and word boundaries', ({ words }) => {
  const workspace = createWorkspace(), definition = romDefinition();
  definition.graph.nodes[1].words = words;
  workspace.library = { ...workspace.library, 'rom-bank@1': definition };
  expect(parseWorkspace(JSON.stringify(workspace)).library['rom-bank@1'].graph.nodes[1].words).toEqual(words);
});

it.each([[-1], [65536], [1.5], ['1'], Array(257).fill(0), null, {}].map(words => ({ words })))('rejects malformed or oversized ROM words', ({ words }) => {
  const workspace = createWorkspace(), definition = romDefinition();
  workspace.library = { ...workspace.library, 'rom-bank@1': definition };
  const raw = JSON.parse(JSON.stringify(workspace));
  raw.library['rom-bank@1'].graph.nodes[1].words = words;
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/ROM/);
});

it('rejects words on non-ROM nodes instead of importing hidden program data', () => {
  const raw = JSON.parse(JSON.stringify(createWorkspace()));
  raw.circuits[1].nodes[0].words = [123];
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/ROM/);
});

it('saves graph structure without node runtime fields or programs on non-ROM nodes', () => {
  const raw = JSON.parse(JSON.stringify(createWorkspace()));
  raw.circuits[1].nodes[0].words = [123];
  raw.circuits[1].nodes[0].runtimeValue = 1;
  raw.circuits[1].state = { cycle: 18, memories: { ram: [255] } };
  let saved = '';
  vi.stubGlobal('localStorage', { setItem: (_key: string, text: string) => { saved = text; } });
  saveWorkspace(raw);
  const restored = JSON.parse(saved);
  expect(restored.circuits[1]).not.toHaveProperty('state');
  expect(restored.circuits[1].nodes[0]).not.toHaveProperty('words');
  expect(restored.circuits[1].nodes[0]).not.toHaveProperty('runtimeValue');
});

it.each([8, 4, 1])('rejects a ROM stored at %i bits', bits => {
  const workspace = createWorkspace(), definition = romDefinition();
  definition.graph.nodes[1].bits = bits;
  workspace.library = { ...workspace.library, 'rom-bank@1': definition };
  expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/位宽/);
});

it('rejects a sixteen-bit program wired into an eight-bit output', () => {
  const workspace = createWorkspace(), definition = romDefinition();
  definition.outputs[0].bits = 8;
  definition.graph.nodes[2].bits = 8;
  workspace.library = { ...workspace.library, 'rom-bank@1': definition };
  expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/位宽/);
});

it('rejects RAM stored with a sixteen-bit data width', () => {
  const raw = JSON.parse(JSON.stringify(createWorkspace()));
  raw.circuits[1].nodes.push({ id: 'memory', label: 'RAM', type: 'RAM', bits: 16, position: { x: 200, y: 0 } });
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/位宽/);
});
