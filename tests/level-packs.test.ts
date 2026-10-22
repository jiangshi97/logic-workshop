// 关卡包机制测试：compileCatalogue 的 id 平移与守卫（内存假包）、生成器/钩子的命名空间解析
// （含 example 包的真实注册表与随包关卡）、包机器合并的 sourceLevel 翻译，以及基础目录冻结不变。
import { describe, expect, it } from 'vitest';
import { isOnceLevelEvent, LEVEL_EVENTS, LEVEL_HOOK_KEYS, RECURRING_LEVEL_EVENTS } from 'logic-level-api';
import { compileCatalogue } from '../src/levelRegistry';
import { levelPacks, resolveCaseGenerator, resolveHook, resolveScenarioGenerator, type LevelPack } from '../src/levelPack';
import { chapters, levels } from '../src/levels';
import { machines, packMachinesOf, type MachineDescriptor } from '../src/machines';
import { generatedLevelPacks } from '../src/levelPacks.generated';

const spec = (id: number, extra: Record<string, unknown> = {}) => ({
  id, title: `关卡 ${id}`, caption: '包关卡', goal: '目标', formula: 'Y = A', chapter: 8,
  inputs: [['A', 1]], outputs: [['Y', 1]], hints: ['一', '二', '三'],
  combinational: { expect: { Y: 'A' } }, ...extra,
});
const makePack = (over: Partial<LevelPack> = {}): LevelPack => ({ key: 'beta', idBase: 100, chapters: ['扩展章节'], ...over });
const compile = (data: unknown[], tags: string[], packs: LevelPack[]) =>
  compileCatalogue(data, data.map((_, index) => (tags[index] ? `content/packs/${tags[index]}/levels/${index}.json` : `content/levels/${index}.json`)), tags, packs);

describe('compileCatalogue', () => {
  it('shifts pack-local ids by idBase and tags pack levels', () => {
    const merged = compile([spec(1), spec(2), spec(3)], ['beta', 'beta', 'beta'], [makePack()]);
    expect(merged.map(level => level.id)).toEqual([101, 102, 103]);
    expect(merged.every(level => level.pack === 'beta')).toBe(true);
  });

  it('only requires ids to be unique within each pack', () => {
    const alpha = makePack({ key: 'alpha', idBase: 100 }), beta = makePack({ key: 'beta', idBase: 200 });
    const merged = compile([spec(1), spec(1)], ['alpha', 'beta'], [alpha, beta]);
    expect(merged.map(level => level.id)).toEqual([101, 201]);
  });

  it('keeps pack ids strictly above the base catalogue', () => {
    const base = spec(5, { chapter: 1 });
    expect(compile([base, spec(1)], ['', 'beta'], [makePack({ idBase: 100 })]).map(level => level.id)).toEqual([5, 101]);
    expect(() => compile([base, spec(1)], ['', 'beta'], [makePack({ idBase: 3 })])).toThrow(/必须大于基础目录最大关卡号/);
  });

  it('rejects overlapping id ranges between packs', () => {
    const alpha = makePack({ key: 'alpha', idBase: 100 }), beta = makePack({ key: 'beta', idBase: 105 });
    expect(() => compile([spec(1), spec(10), spec(1)], ['alpha', 'alpha', 'beta'], [alpha, beta])).toThrow(/区间（.*相交/);
  });

  it('rejects duplicate global ids, unknown pack tags and chapters beyond the merged list', () => {
    const alpha = makePack({ key: 'alpha', idBase: 100 }), beta = makePack({ key: 'beta', idBase: 100 });
    expect(() => compile([spec(1), spec(1)], ['alpha', 'beta'], [alpha, beta])).toThrow(/重复/);
    expect(() => compile([spec(1)], ['ghost'], [makePack()])).toThrow(/未注册/);
    expect(() => compile([spec(1, { chapter: 8 })], ['beta'], [makePack({ chapters: undefined })])).toThrow(/章节号/);
  });

  it('expands namespaced generators and hands them pack context', () => {
    const contexts: unknown[] = [];
    const pack = makePack({
      scenarioGenerators: new Map([['echo', context => {
        contexts.push(context);
        return [{ label: '保持', steps: [{ inputs: { A: 0 }, expected: { Y: 0 } }, { inputs: { A: 1 }, expected: { Y: 1 } }] }];
      }]]),
    });
    const merged = compile([spec(1, { combinational: undefined, sequential: { generator: 'beta/echo' } })], ['beta'], [pack]);
    expect(merged[0].mode).toBe('sequential');
    expect(merged[0].sequences!()).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ id: 101, pack: 'beta', localId: 1 });
    expect(() => compile([spec(1, { combinational: undefined, sequential: { generator: 'beta/nope' } })], ['beta'], [pack])).toThrow(/未知的生成器/);
  });
});

describe('the shipped example pack and extension resolvers', () => {
  it('ships the example pack with one sample level above the frozen base catalogue', () => {
    expect(generatedLevelPacks.map(entry => entry.folder)).toEqual(['example']);
    expect(levelPacks.map(pack => pack.key)).toEqual(['example']);
    const base = levels.filter(level => level.pack === undefined);
    expect(base.map(level => level.id)).toEqual(Array.from({ length: 56 }, (_, index) => index + 1));
    const shipped = levels.filter(level => level.pack === 'example');
    expect(shipped.map(level => level.id)).toEqual([901]); // idBase 900 + 包内 1 号
    expect(shipped[0].hooks).toEqual({ onFirstClear: 'example/celebrate', onFirstHint: 'example/nudge', onEveryTest: 'example/coach' });
    expect(chapters).toHaveLength(7); // 示例关卡复用第 7 章，包未追加章节
    expect(machines.map(machine => machine.key)).toEqual(['computer-44']);
  });

  it('splits hook events into persisted one-shot keys and recurring keys', () => {
    expect(LEVEL_EVENTS).toEqual(['onEnter', 'onFirstHint', 'onAllHints', 'onFirstFail', 'onFirstClear', 'onFirstPackage', 'onFirstProgramApply']);
    expect(RECURRING_LEVEL_EVENTS).toEqual(['onEveryEnter', 'onEveryTest']);
    expect(LEVEL_HOOK_KEYS).toHaveLength(9);
    expect(isOnceLevelEvent('onEveryTest')).toBe(false);
    expect(isOnceLevelEvent('onFirstClear')).toBe(true);
  });

  it('resolves bare generator names from the base registry and namespaced ones from packs', () => {
    expect(resolveScenarioGenerator('temporal')).toBeTypeOf('function');
    expect(resolveCaseGenerator('alu-cases')).toBeTypeOf('function');
    expect(resolveScenarioGenerator('alu-cases')).toBeUndefined();
    expect(resolveScenarioGenerator('example/hold')).toBeTypeOf('function');
    expect(resolveScenarioGenerator('example/nope')).toBeUndefined();
    expect(resolveHook('example/celebrate')).toBeTypeOf('function');
    expect(resolveHook('celebrate')).toBeUndefined();
    expect(resolveHook('example/nope')).toBeUndefined();
  });
});

describe('packMachinesOf', () => {
  const stubMachine = (key: string, sourceLevel: number): MachineDescriptor => ({
    key, name: key, sourceLevel, instructions: ['NOP', 'HLT'],
    circuit: () => { throw new Error('stub'); }, library: () => ({}),
  });

  it('translates local sourceLevel to the global id and validates existence', () => {
    const pack = makePack({ machines: [stubMachine('m-a', 5)] });
    expect(packMachinesOf([pack], [{ id: 105 }])).toEqual([expect.objectContaining({ key: 'm-a', sourceLevel: 105 })]);
    expect(() => packMachinesOf([pack], [{ id: 104 }])).toThrow(/来源关卡不存在/);
    expect(() => packMachinesOf([makePack({ machines: [stubMachine('m-b', 0)] })], [])).toThrow(/sourceLevel/);
  });
});
