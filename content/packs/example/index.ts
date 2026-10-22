// 示例关卡包：演示全部扩展点的正确接线。本包不携带关卡（总进度不变），仅注册
// 一个场景生成器与一个通关钩子供测试与后续包作者参考；完整规则见
// docs/level-authoring.md 的“关卡包”一节。
// 规则提醒：顶层只组装描述符、不调用 src 的运行时函数；对 src 只做 type import。
import type { ScenarioGenerator } from '../../../src/levelGenerators';
import type { HookContext, LevelPack } from '../../../src/levelPack';
import type { ScenarioSpec } from '../../../src/levelSpec';

/** 示例场景生成器：关卡 JSON 以 "sequential": { "generator": "example/hold" } 引用，
 *  编译期展开为具体帧并走与手写数据完全相同的校验。 */
const holdScenarios: ScenarioGenerator = ({ inputPorts, outputPorts }) => {
  const defaults = Object.fromEntries(inputPorts.map(port => [port.id, 0]));
  const expected = Object.fromEntries(outputPorts.map(port => [port.id, 0]));
  const steps = [0, 1].map(() => ({ inputs: { ...defaults }, expected: { ...expected } }));
  return [{ label: '保持', steps }] satisfies ScenarioSpec[];
};

/** 示例通关钩子：关卡 JSON 以 "hooks": { "onFirstClear": "example/celebrate" } 引用，
 *  在该关首次通过判题时触发一次（触发记录随存档持久化，不会重放）。 */
const celebrate = ({ level, showMessage }: HookContext) => {
  showMessage('示例钩子', `「${level.title}」首次通关！这行文字来自关卡包里的 TypeScript 钩子。`);
};

export const pack: LevelPack = {
  key: 'example',   // 必须与文件夹同名；JSON 引用用它做命名空间（example/hold）。
  idBase: 900,      // 本包关卡的全局 id = 900 + JSON id（本包暂无关卡，仅占位）。
  scenarioGenerators: new Map([['hold', holdScenarios]]),
  hooks: new Map([['celebrate', celebrate]]),
};
