// 关卡包：新增关卡与其专属 TypeScript 的唯一入口（运行时汇总）。
// 公共 API（事件目录、HookContext、LevelPack 描述符、工具）住在 packages/level-api——
// 关卡包代码统一从 'logic-level-api' 导入；本文件负责装载生成清单与引用解析。
// 包规则：①index.ts 顶层只组装描述符，不得调用 levels/machines 的函数（模块求值期关卡目录尚未就绪）；
// ②生成器在编译期、钩子在事件期运行，都不得依赖 levels 目录本身；③对 machines.ts 只做 type import
// （防运行时循环依赖）；④包内组件键应避开基础目录的 architecture-* 前缀，防止与规范教学组件同名。
import { caseGenerators as baseCaseGenerators, scenarioGenerators as baseScenarioGenerators } from './levelGenerators';
import { generatedLevelPacks } from './levelPacks.generated';
import type { CaseGenerator, LevelPack, LevelHook, ScenarioGenerator } from 'logic-level-api';

export * from 'logic-level-api';

// 包键只要求不含空白与斜杠（1–64 字符）：下划线、大写与中文都可用；斜杠会破坏“包键/名字”引用的解析。
const PACK_KEY = /^[^\s/]{1,64}$/;
// 启动期校验生成清单：声明的 key 必须与文件夹一致，形状必须合法（守卫生成脚本与手写漂移）。
export const levelPacks: readonly LevelPack[] = generatedLevelPacks.map(({ folder, pack }) => {
  if (!pack || typeof pack !== 'object') throw new Error(`关卡包 ${folder} 缺少 pack 描述符。`);
  if (pack.key !== folder) throw new Error(`关卡包 ${folder} 声明的 key 是“${String(pack.key)}”，必须与文件夹同名。`);
  if (!PACK_KEY.test(pack.key)) throw new Error(`关卡包键“${pack.key}”不合法（1–64 个字符，不能含空白与斜杠）。`);
  if (!Number.isInteger(pack.idBase) || pack.idBase < 1) throw new Error(`关卡包 ${pack.key} 的 idBase 必须是正整数。`);
  return pack;
});

const packByKey = (key: string): LevelPack | undefined => levelPacks.find(pack => pack.key === key);

/** 解析生成器引用：裸名 → 基础 levelGenerators（老关卡零迁移）；"包键/名字" → 该包的注册表。
 *  find* 接受显式包清单（compileCatalogue 装载时传入，测试可注入假包）；resolve* 绑定全局注册表。 */
export function findScenarioGenerator(ref: string, packs: readonly LevelPack[]): ScenarioGenerator | undefined {
  const slash = ref.indexOf('/');
  return slash < 0 ? baseScenarioGenerators.get(ref) : packs.find(pack => pack.key === ref.slice(0, slash))?.scenarioGenerators?.get(ref.slice(slash + 1));
}
export function findCaseGenerator(ref: string, packs: readonly LevelPack[]): CaseGenerator | undefined {
  const slash = ref.indexOf('/');
  return slash < 0 ? baseCaseGenerators.get(ref) : packs.find(pack => pack.key === ref.slice(0, slash))?.caseGenerators?.get(ref.slice(slash + 1));
}
export const resolveScenarioGenerator = (ref: string): ScenarioGenerator | undefined => findScenarioGenerator(ref, levelPacks);
export const resolveCaseGenerator = (ref: string): CaseGenerator | undefined => findCaseGenerator(ref, levelPacks);
/** 解析钩子引用（"包键/名字"；钩子只能来自关卡包，裸名恒无匹配）。 */
export function resolveHook(ref: string): LevelHook | undefined {
  const slash = ref.indexOf('/');
  return slash < 0 ? undefined : packByKey(ref.slice(0, slash))?.hooks?.get(ref.slice(slash + 1));
}
