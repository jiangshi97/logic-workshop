import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace, loadWorkspace, parseWorkspace } from '../src/storage';
import { connect, createCircuit } from '../src/model';

afterEach(() => vi.unstubAllGlobals());

it('defers saved-file parsing to the worker instead of blocking startup', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{broken' });
  const loaded = loadWorkspace();
  expect(loaded.savedText).toBe('{broken');
  expect(loaded.workspace.currentLevel).toBe(1);
  expect(loaded.error).toBeUndefined();
});

it('exposes empty saved files for asynchronous error reporting', () => {
  vi.stubGlobal('localStorage', { getItem: () => '' });
  expect(loadWorkspace().savedText).toBe('');
});

it('reports local storage access failures without throwing', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(loadWorkspace().error).toContain('存档读取失败');
});

it('creates all fifty-six drafts and the component library required by fixed CPUs', () => {
  const state = createWorkspace();
  expect(state.version).toBe(6);
  expect(Object.keys(state.circuits)).toHaveLength(56);
  expect(Object.keys(state.library).length).toBeGreaterThan(0);
});

it('migrates the four-lesson format without losing progress', () => {
  const state = createWorkspace();
  const proof = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  const legacy = { version: 1, currentLevel: 2,
    circuits: Object.fromEntries([1, 2, 3, 4].map(id => [id, state.circuits[id]])),
    proofs: { 1: proof }, inputs: { 1: { A: 1 } } };
  for (const circuit of [...Object.values(legacy.circuits), ...Object.values(legacy.proofs)]) {
    for (const node of circuit.nodes) delete node.bits;
  }
  const restored = parseWorkspace(JSON.stringify(legacy));
  expect(restored.version).toBe(6);
  expect(restored.currentLevel).toBe(2);
  expect(restored.proofs[1].wires).toHaveLength(1);
  expect(restored.inputs[1]).toEqual({ A: 1 });
  expect(Object.keys(restored.circuits)).toHaveLength(56);
});

it('can structurally parse candidate proofs for asynchronous verification', () => {
  const state = createWorkspace();
  state.proofs[1] = createCircuit(1);
  state.currentLevel = 20;
  const parsed = parseWorkspace(JSON.stringify(state), { verifyProofs: false });
  expect(parsed.currentLevel).toBe(20);
  expect(parsed.proofs[1]).toBeDefined();
});

it('round-trips the current lesson and independent drafts', () => {
  const state = createWorkspace();
  state.circuits[1] = connect(state.circuits[1], 'A', 'out', 'Y', 'in');
  state.proofs[1] = structuredClone(state.circuits[1]);
  state.currentLevel = 2;
  const restored = parseWorkspace(JSON.stringify(state));
  expect(restored.currentLevel).toBe(2);
  expect(restored.circuits[1].wires).toHaveLength(1);
  expect(restored.circuits[2].wires).toHaveLength(0);
});

it('does not trust a forged pass record', () => {
  const state = createWorkspace();
  state.currentLevel = 4;
  state.proofs[1] = createCircuit(1);
  expect(parseWorkspace(JSON.stringify(state)).currentLevel).toBe(1);
});

it('rejects broken files before changing existing drafts', () => {
  expect(() => parseWorkspace('{')).toThrow();
  const state = createWorkspace();
  state.circuits[1].nodes.pop();
  expect(() => parseWorkspace(JSON.stringify(state))).toThrow(/端口/);
});

it('keeps a valid pass proof independent of subsequent edits', () => {
  const state = createWorkspace();
  state.proofs[1] = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  state.currentLevel = 2;
  expect(parseWorkspace(JSON.stringify(state)).currentLevel).toBe(2);
});
