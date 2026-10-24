// 示例关卡包：演示全部扩展点的正确接线。公共 API（事件目录、HookContext、工具）统一从
// 'logic-level-api' 导入（packages/level-api，见其 README）；完整规则见 docs/level-authoring.md
// 的“关卡包”一节。包内携带一个示例关卡（levels/001-my-pack-test.json，全局 id 901）。
// 规则提醒：顶层只组装描述符、不调用 src 的运行时函数；对宿主 src 只做 type import。
import { range, type HookContext, type LevelHook, type LevelPack, type ScenarioGenerator, type CaseGenerator } from 'logic-level-api';
import type { ScenarioSpec } from '../../../src/levelSpec';

/** 示例场景生成器：关卡 JSON 以 "sequential": { "generator": "example/hold" } 引用，
 *  编译期展开为具体帧并走与手写数据完全相同的校验。 */
const holdScenarios: ScenarioGenerator = ({ inputPorts, outputPorts }) => {
  const defaults = Object.fromEntries(inputPorts.map(port => [port.id, 0]));
  const expected = Object.fromEntries(outputPorts.map(port => [port.id, 0]));
  const steps = range(2).map(() => ({ inputs: { ...defaults }, expected: { ...expected } }));
  return [{ label: '保持', steps }] satisfies ScenarioSpec[];
};

/** 示例通关钩子（onFirstClear）：showMessage 弹窗 + 本关私有 store 演示（随存档持久化）。 */
const celebrate = ({ level, showMessage, store }: HookContext) => {
  const visits = (store.get<number>('clearCount') ?? 0) + 1;
  store.set('clearCount', visits);
  showMessage('示例钩子', `「${level.title}」首次通关！这行文字来自关卡包里的 TypeScript 钩子（第 ${visits} 次记录已写入 packState）。`);
};

const firstIntoUc = ({ level, showMessage, store }: HookContext) => {
  const visits = (store.get<number>('clearCount') ?? 0) + 1;
  store.set('clearCount', visits);
  showMessage('新关卡', `「${level.title}」上一个ISA对于一个通用计算机是不够的，我们希望能扩展ISA以实现更强的计算功能。`);
}

const alu6CaseList: CaseGenerator = ({ localId }) => {
  if (localId !== 1) return [];           // 将来包里再加关卡时按 localId 分派
  const cases = [];
  for (const A of range(256)) {
    const partners = new Set([0, 1, 127, 128, 254, 255, A, 255 - A, (A * 73) & 255]);
    for (const B of partners) for (const op of range(6)) cases.push({ A, B, Op: op });   // Op 0..5
  }
  for (const [A, B, Op] of [[0, 0, 6], [255, 1, 15], [128, 128, 9]] as const)
    cases.push({ A, B, Op });             // 非法 Op 走 expect 的 `: 0` 分支
  return cases;
};

const hooks = new Map<string, LevelHook>([['first-into-uc', firstIntoUc]]);

export const pack: LevelPack = {
  key: 'useful-computer',   // 必须与文件夹同名；JSON 引用它做命名空间（example/hold）。
  idBase: 920,      // 本包关卡的全局 id = 900 + JSON id（示例关 001 → 全局 901）。
  scenarioGenerators: new Map([['hold', holdScenarios]]),
  caseGenerators: new Map([['alu6-cases', alu6CaseList]]),
  chapters: ['指令集扩展'],
  hooks,
};
