import { describe, expect, it } from 'vitest';
import { chapters, getLevel, levels, testInputs, testSequences } from '../src/levels';
import { validateCircuit } from '../src/model';
import { judge, replaySequence, simulate } from '../src/simulator';
import { referenceCircuit } from './fixtures';

describe('state and time curriculum', () => {
  it('appends twelve temporal lessons without changing the original twenty', () => {
    expect(levels.slice(0, 32).map(level => level.id)).toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
    expect(chapters[4]).toBe('状态与时间');
    for (const level of levels.slice(20, 32)) {
      expect(level.mode).toBe('sequential');
      expect(level.chapter).toBe(5);
      expect(level.allowed).toContain('DFF');
      expect(testInputs(level.id)).toEqual([]);
      expect(level.sequences!().length).toBeGreaterThan(0);
    }
  });

  for (let id = 21; id <= 32; id++) it(`lesson ${id} has a legal complete temporal solution`, () => {
    const circuit = referenceCircuit(id);
    expect(circuit.nodes.length).toBeLessThanOrEqual(200);
    expect(circuit.wires.length).toBeLessThanOrEqual(400);
    expect(validateCircuit(circuit)).toEqual([]);
    const result = judge(circuit);
    expect(result.error).toBeUndefined();
    expect(result.passed, JSON.stringify(result.failure)).toBe(true);
    expect(result.rows.length).toBe(testSequences(id).reduce((total, sequence) => total + sequence.steps.length, 0));
  }, 30000);

  it('covers all byte values with capture, repeated capture and enable hold', () => {
    const steps = testSequences(24).flatMap(sequence => sequence.steps);
    expect(new Set(steps.filter(s => s.tick && s.inputs.E === 1 && s.inputs.R === 0).map(s => s.expectedOutputs.Q)).size).toBe(256);
    for (let D = 0; D < 256; D++) {
      expect(steps.some(s => s.tick && s.inputs.D === D && s.inputs.E === 1 && s.expectedOutputs.Q === D)).toBe(true);
      expect(steps.some(s => s.tick && s.inputs.D === 255 - D && s.inputs.E === 0 && s.inputs.R === 0 && s.expectedOutputs.Q === D)).toBe(true);
    }
  });

  it('specifies every public input and output within its width with deterministic scenario ids', () => {
    for (const level of levels.slice(20, 32)) {
      const sequences = testSequences(level.id);
      expect(sequences).toEqual(testSequences(level.id));
      expect(new Set(sequences.map(s => s.id)).size).toBe(sequences.length);
      for (const sequence of sequences) for (const step of sequence.steps) {
        expect(Object.keys(step.inputs)).toEqual(level.inputs);
        expect(Object.keys(step.expectedOutputs)).toEqual(level.outputPorts.map(p => p.id));
        for (const port of level.inputPorts) expect(step.inputs[port.id]).toBeLessThan(2 ** port.bits);
        for (const port of level.outputPorts) expect(step.expectedOutputs[port.id]).toBeLessThan(2 ** port.bits);
      }
    }
  });

  it('contains counter wrap, underflow, all shift patterns, and old pipeline values', () => {
    const up = testSequences(26)[0].steps.filter(s => s.tick && s.inputs.E && !s.inputs.R);
    expect(up.slice(0, 17).map(s => s.expectedOutputs.Q)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1]);
    const down = testSequences(27)[1].steps.filter(s => s.tick && s.inputs.E && !s.inputs.R);
    expect(down[0].expectedOutputs.Q).toBe(15);
    expect(down[15].expectedOutputs.Q).toBe(0);
    expect(testSequences(28).map(s => s.steps[12].expectedOutputs.Q)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const pipeline = testSequences(29)[0].steps;
    const firstWrite = pipeline.findIndex(s => s.inputs.D === 1 && s.tick && s.inputs.E === 1);
    expect(pipeline[firstWrite].expectedOutputs.Q).toBe(0);
    expect(pipeline[firstWrite + 1].expectedOutputs.Q).toBe(0);
    expect(pipeline[firstWrite + 2].expectedOutputs.Q).toBe(1);
  });

  it('tests every memory address and data with asynchronous reads and same-edge old data', () => {
    for (const id of [30, 31, 32]) {
      const size = id === 30 ? 2 : 4;
      const scenarios = testSequences(id);
      expect(scenarios).toHaveLength(size * 16);
      for (let Addr = 0; Addr < size; Addr++) for (let D = 0; D < 16; D++) {
        const steps = scenarios[Addr * 16 + D].steps;
        const capture = steps.find(s => s.tick && s.inputs.Addr === Addr && s.inputs.D === D && s.inputs.W === 1 && s.inputs.Read === (id === 32 ? 1 : undefined));
        expect(capture).toBeDefined();
        expect(steps.filter(s => !s.tick).some(s => s.inputs.Addr !== Addr)).toBe(true);
        if (id === 32) {
          const captureIndex = steps.findIndex(s => s.tick && s.inputs.Read === 1 && s.inputs.W === 1);
          expect(steps[captureIndex].expectedOutputs).toEqual({ Memory: D, Out: (Addr * 3 + 5) % 16 });
        }
      }
    }
    // 时序关的 expectedOutputs 只是兼容占位（返回首帧期望），真正的判题始终走 sequences 场景。
    expect(getLevel(32).expectedOutputs({ Addr: 2, D: 7, W: 1, Read: 1, R: 0 })).toEqual(testSequences(32)[0].steps[0].expectedOutputs);
  });

  it('replays a history-dependent counterexample including internal register state repeatedly', () => {
    const wrong = referenceCircuit(23);
    const feedback = wrong.wires.find(wire => wire.sourceHandle === 'q' && wire.target !== 'Q')!;
    wrong.nodes.push({ id: 'zero', type: 'CONST', label: 'CONST', bits: 1, value: 0, position: { x: 0, y: 0 } });
    feedback.source = 'zero'; feedback.sourceHandle = 'out';
    const result = judge(wrong), failure = result.failure!;
    expect(result.error).toBeUndefined();
    expect(result.passed).toBe(false);
    expect(failure.scenarioId).toBeDefined();
    expect(failure.stepIndex).toBeGreaterThan(0);
    const scenario = testSequences(23).find(sequence => sequence.id === failure.scenarioId)!;
    const prefix = scenario.steps.slice(0, failure.stepIndex! + 1);
    const first = replaySequence(wrong, {}, prefix), repeated = replaySequence(wrong, {}, prefix);
    expect(repeated).toEqual(first);
    expect(first.values.Q).toBe(failure.actualOutputs.Q);
    expect(first.state!.cycle).toBe(failure.cycle);
    expect(first.trace!.at(-1)!.outputs).toEqual(failure.actualOutputs);
    const correct = referenceCircuit(23);
    expect(replaySequence(correct, {}, prefix).values.Q).toBe(failure.expectedOutputs.Q);
    expect(simulate(correct, failure.inputs, {}, { tick: failure.tick }).values.Q).not.toBe(failure.expectedOutputs.Q);
  });

  it('rejects capturing write data rather than the old addressed memory on a simultaneous read and write', () => {
    const wrong = referenceCircuit(32);
    const outRegister = wrong.wires.find(wire => wire.target === 'Out')!.source;
    const registerMux = wrong.wires.find(wire => wire.target === outRegister && wire.targetHandle === 'd')!.source;
    const dataGate = wrong.wires.find(wire => wire.target === registerMux && wire.targetHandle === 'b')!.source;
    const dataInput = wrong.wires.find(wire => wire.target === dataGate && wire.targetHandle === 'a')!;
    dataInput.source = 'D'; dataInput.sourceHandle = 'out';
    const result = judge(wrong), failure = result.failure!;
    expect(result.passed).toBe(false);
    expect(failure.inputs.W).toBe(1);
    expect(failure.inputs.Read).toBe(1);
    expect(failure.mismatches).toEqual(['Out']);
    const scenario = testSequences(32).find(s => s.id === failure.scenarioId)!;
    const prefix = scenario.steps.slice(0, failure.stepIndex! + 1);
    const replay = replaySequence(wrong, {}, prefix);
    expect(replay.values.Out).toBe(failure.actualOutputs.Out);
    expect(replay.values.Memory).toBe(failure.expectedOutputs.Memory);
  }, 30_000);
});
