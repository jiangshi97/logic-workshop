// 包关卡参考电路守卫：所有关卡的 fixtures 参考电路必须通过结构校验（含 model.ts 的
// 200 节点/400 线存档规模上限——超限会让 e2e 的存档导入直接被拒），包内组合关的参考电路
// 还要在全部公开用例上与关卡期望值一致（判题与参考实现是两套独立实现，互为对拍）。
import { describe, expect, it } from 'vitest';
import { getLevel, levels, testInputs } from '../src/levels';
import { validateCircuit } from '../src/model';
import { compileCombinational } from '../src/combinationalEvaluator';
import { referenceCircuit } from './fixtures';
import { architectureLibrary } from '../src/architectureCircuits';

describe('pack reference circuits', () => {
  it('keeps every fixture circuit valid and within the save size limits', () => {
    const library = architectureLibrary();
    for (const level of levels)
      expect(validateCircuit(referenceCircuit(level.id), library), `关卡 ${level.id}`).toEqual([]);
  });

  it('solves the six-operation ALU pack level against its full public case set', () => {
    const run = compileCombinational(referenceCircuit(921));
    expect(run).toBeTypeOf('function');
    const cases = testInputs(921);
    expect(cases.length).toBeGreaterThan(13000); // 全 A × 边界 B × Op 0..5 + 非法 Op 抽检
    for (const inputs of cases) expect(run!(inputs)).toEqual(getLevel(921).expectedOutputs(inputs));
  });
});
