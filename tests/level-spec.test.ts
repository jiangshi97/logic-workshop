import { describe, expect, it } from 'vitest';
import { compileLevelSpec, defineLevel, programCaseRegistry } from '../src/levelSpec';
import { programmingCases, programmingReferenceSource } from '../src/programmingSpec';

const spec101 = {
  id: 101, title: '测试关卡', caption: '副标题', goal: '目标描述', formula: 'Y = ~(A & B)', chapter: 1,
  inputs: [['A', 1], ['B', 1]], outputs: [['Y', 1]],
  hints: ['提示一', '提示二', '提示三'], rewardName: '测试元件',
  combinational: { expect: { Y: '~(A & B)' } },
};

describe('level spec compilation', () => {
  it('compiles a combinational spec with expressions and derived fields', () => {
    const level = compileLevelSpec(spec101);
    expect(level.id).toBe(101);
    expect(level.mode).toBeUndefined();
    expect(level.inputPorts).toEqual([{ id: 'A', label: 'A', bits: 1 }, { id: 'B', label: 'B', bits: 1 }]);
    expect(level.outputPorts).toEqual([{ id: 'Y', label: 'Y', bits: 1 }]);
    expect(level.rewardName).toBe('测试元件');
    expect(level.expectedOutputs({ A: 1, B: 1 })).toEqual({ Y: 0 });
    expect(level.expectedOutputs({ A: 0, B: 1 })).toEqual({ Y: 1 });
  });

  it('derives allowed from the unlock table for ids up to 20 and full set above', () => {
    expect(compileLevelSpec({ ...spec101, id: 3 }).allowed).toEqual(['NAND']);
    expect(compileLevelSpec({ ...spec101, id: 19 }).allowed).toEqual(['NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'SPLIT', 'JOIN', 'CONST']);
    expect(compileLevelSpec({ ...spec101, id: 99 }).allowed).toContain('DFF');
  });

  it('masks expression results to the output port width', () => {
    const level = compileLevelSpec({
      ...spec101, combinational: { expect: { Y: 'A + B' } },
    });
    expect(level.expectedOutputs({ A: 15, B: 1 })).toEqual({ Y: 0 });
  });

  it('compiles truth-table specs and reports missing rows at evaluation time', () => {
    const level = compileLevelSpec({
      ...spec101,
      combinational: { truthTable: [
        { inputs: { A: 0, B: 0 }, outputs: { Y: 1 } },
        { inputs: { A: 1, B: 1 }, outputs: { Y: 0 } },
      ] },
    });
    expect(level.expectedOutputs({ A: 0, B: 0 })).toEqual({ Y: 1 });
    expect(() => level.expectedOutputs({ A: 0, B: 1 })).toThrow(/真值表缺少输入组合/);
  });

  it('exposes public cases and fills defaults in sequential scenarios', () => {
    const { combinational: _drop, ...base } = spec101;
    const sequential = compileLevelSpec({
      ...base, id: 102, inputs: [['D', 1], ['E', 1]], outputs: [['Q', 1]],
      sequential: { scenarios: [{ label: '采样', steps: [
        { inputs: { D: 1 }, tick: false, expected: { Q: 0 } },
        { inputs: { D: 1 }, expected: { Q: 1 } },
      ] }] },
    });
    expect(sequential.mode).toBe('sequential');
    expect(sequential.cases).toBeUndefined();
    const [scenario] = sequential.sequences!();
    expect(scenario.id).toBe('level-102-scenario-1');
    expect(scenario.steps).toEqual([
      { inputs: { D: 1, E: 0 }, tick: false, expectedOutputs: { Q: 0 } },
      { inputs: { D: 1, E: 0 }, tick: true, expectedOutputs: { Q: 1 } },
    ]);

    const combinational = compileLevelSpec({
      ...spec101,
      combinational: { expect: { Y: 'A | B' }, cases: [{ A: 0, B: 1 }] },
    });
    expect(combinational.cases!()).toEqual([{ A: 0, B: 1 }]);
  });

  it('registers program cases and reference source for the programming judge', () => {
    const { combinational: _drop, ...base } = spec101;
    compileLevelSpec({
      ...base, id: 990, inputs: [['X', 8]], outputs: [['Y', 8]],
      program: {
        cases: [{ label: '翻倍', memory: { '240': 7 }, expectedOutput: [14], maxCycles: 90 }],
        referenceSource: 'MOVI A, 1\nHLT',
      },
    });
    const cases = programmingCases(990);
    expect(cases).toHaveLength(1);
    expect(cases[0].memory).toEqual({ 240: 7 });
    expect(cases[0].expectedOutput).toEqual([14]);
    expect(programmingReferenceSource(990)).toBe('MOVI A, 1\nHLT');
    programCaseRegistry.delete(990);
  });

  it('accepts namespaced hook declarations and carries them onto the Level', () => {
    const level = compileLevelSpec({ ...spec101, hooks: { onEnter: 'example/intro', onFirstClear: 'example/celebrate' } });
    expect(level.hooks).toEqual({ onEnter: 'example/intro', onFirstClear: 'example/celebrate' });
    expect(compileLevelSpec(spec101).hooks).toBeUndefined();
  });

  it('accepts flexible hook reference names — underscores, capitals and non-ASCII are fine', () => {
    expect(compileLevelSpec({ ...spec101, hooks: { onEnter: 'my_pack/First_Hook' } }).hooks)
      .toEqual({ onEnter: 'my_pack/First_Hook' });
    expect(compileLevelSpec({ ...spec101, hooks: { onEnter: '我的扩展/开场白' } }).hooks)
      .toEqual({ onEnter: '我的扩展/开场白' });
  });

  it('defers chapter upper bounds to catalogue compilation (pack chapters may extend the list)', () => {
    expect(compileLevelSpec({ ...spec101, chapter: 13 }).chapter).toBe(13);
  });

  it('accepts every documented hook event, one-shot and recurring alike', () => {
    const hooks = {
      onEnter: 'p/a', onFirstHint: 'p/b', onAllHints: 'p/c', onFirstFail: 'p/d', onFirstClear: 'p/e',
      onFirstPackage: 'p/f', onFirstProgramApply: 'p/g', onEveryEnter: 'p/h', onEveryTest: 'p/i',
    };
    expect(compileLevelSpec({ ...spec101, hooks }).hooks).toEqual(hooks);
  });

  it('accepts typed specs through defineLevel with the same validation', () => {
    const level = defineLevel({ ...spec101, combinational: { expect: { Y: 'A & B' } } } as never);
    expect(level.expectedOutputs({ A: 1, B: 1 })).toEqual({ Y: 1 });
    expect(() => defineLevel({ ...spec101, hints: ['仅一条'] } as never)).toThrow(/hints/);
  });
});

describe('level spec rejection', () => {
  const rejects = (spec: unknown, pattern: RegExp) =>
    expect(() => compileLevelSpec(spec)).toThrow(pattern);

  it('rejects structural problems', () => {
    rejects(null, /JSON 对象/);
    rejects({ ...spec101, id: 0 }, /id/);
    rejects({ ...spec101, title: '' }, /title/);
    rejects({ ...spec101, chapter: 0 }, /chapter/);
    rejects({ ...spec101, hints: ['一', '二'] }, /hints/);
    rejects({ ...spec101, inputs: [] }, /不能为空/);
    rejects({ ...spec101, inputs: [['A', 1], ['A', 1]] }, /重复/);
    rejects({ ...spec101, inputs: [['div', 1]] }, /保留字/);
    rejects({ ...spec101, inputs: [['A', 0]] }, /位宽/);
    rejects({ ...spec101, inputs: [['A', 1]], outputs: [['A', 1]] }, /重复/);
    rejects({ ...spec101, allowed: ['NAND', 'LASER'] }, /allowed/);
    rejects({ ...spec101, defaultProgram: [0x10000] }, /defaultProgram/);
    rejects({ ...spec101, hooks: { onWin: 'example/x' } }, /hooks 的键/);
    rejects({ ...spec101, hooks: { onEnter: 'celebrate' } }, /包键\/钩子名/);
    rejects({ ...spec101, hooks: { onEnter: 'has space/x' } }, /包键\/钩子名/);
    rejects({ ...spec101, hooks: { onEnter: 'a/b/c' } }, /包键\/钩子名/);
    rejects({ ...spec101, hooks: 'nope' }, /hooks 必须是对象/);
  });

  it('rejects missing or duplicated mode sections', () => {
    const { combinational: _drop, ...withoutMode } = spec101;
    rejects(withoutMode, /必须且只能提供/);
    rejects({ ...withoutMode, sequential: { scenarios: [{ label: 'x', steps: [{ inputs: {}, expected: {} }] }] }, combinational: { expect: { Y: 'A' } } }, /必须且只能提供/);
  });

  it('rejects invalid combinational data', () => {
    const { combinational: _drop, ...base } = spec101;
    rejects({ ...base, combinational: {} }, /expect 表达式或 truthTable/);
    rejects({ ...base, combinational: { expect: { Y: 'A + Q' } } }, /未声明/);
    rejects({ ...base, combinational: { expect: { Y: 'A +' } } }, /表达式无效/);
    rejects({ ...base, combinational: { expect: { Z: 'A' } } }, /恰好覆盖/);
    rejects({ ...base, combinational: { truthTable: [{ inputs: { A: 0 }, outputs: { Y: 1 } }] } }, /缺少输入端口/);
    rejects({ ...base, combinational: { expect: { Y: 'A' }, cases: [{ A: 5, B: 0 }] } }, /超出位宽/);
  });

  it('rejects invalid sequential and program data', () => {
    const { combinational: _drop, ...base } = spec101;
    rejects({ ...base, sequential: { scenarios: [] } }, /scenarios/);
    rejects({
      ...base, sequential: { scenarios: [{ label: 'x', steps: [{ inputs: { A: 0, B: 0 }, expected: {} }] }] },
    }, /缺少期望输出/);
    rejects({ ...base, program: { cases: [] } }, /cases/);
    rejects({
      ...base, program: { cases: [{ label: 'x', memory: { '300': 1 }, expectedOutput: [], maxCycles: 90 }] },
    }, /地址/);
    rejects({
      ...base, program: { cases: [{ label: 'x', memory: {}, expectedOutput: [], maxCycles: 0 }] },
    }, /maxCycles/);
  });
});
