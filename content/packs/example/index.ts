// 示例关卡包：演示全部扩展点的正确接线。公共 API（事件目录、HookContext、工具）统一从
// 'logic-level-api' 导入（packages/level-api，见其 README）；完整规则见 docs/level-authoring.md
// 的“关卡包”一节。包内携带一个示例关卡（levels/001-my-pack-test.json，全局 id 901）。
// 规则提醒：顶层只组装描述符、不调用 src 的运行时函数；对宿主 src 只做 type import。
import { range, type HookContext, type LevelHook, type LevelPack, type ScenarioGenerator } from 'logic-level-api';
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

/** 示例提示钩子（onFirstHint）：toast 通道演示。 */
const nudge = ({ notify, draft }: HookContext) => {
  notify(`试试把 B 按位取反再加一（当前草稿 ${draft.nodes} 个节点）。`);
};

/** 示例判题钩子（onEveryTest，周期性）：按失败次数递进提示，演示 test 报告与 store 计数。 */
const coach = ({ notify, store, test }: HookContext) => {
  if (test?.passed) return;
  const fails = (store.get<number>('failCount') ?? 0) + 1;
  store.set('failCount', fails);
  if (fails >= 2) notify(`已连续未通过 ${fails} 次：Diff = (A − B) mod 16，想想最高位进位去哪了。`);
};

const hooks = new Map<string, LevelHook>([['celebrate', celebrate], ['nudge', nudge], ['coach', coach]]);

export const pack: LevelPack = {
  key: 'example',   // 必须与文件夹同名；JSON 引用它做命名空间（example/hold）。
  idBase: 900,      // 本包关卡的全局 id = 900 + JSON id（示例关 001 → 全局 901）。
  scenarioGenerators: new Map([['hold', holdScenarios]]),
  hooks,
};
