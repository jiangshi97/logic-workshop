// 关卡包：新增关卡与其专属 TypeScript 的唯一入口（扩展点汇总）。
// 一个包 = content/packs/<key>/ 目录：levels/*.json 放关卡数据，index.ts 导出本描述符，
// 其余 TS（生成器/钩子/机器电路/参考实现）自由组织。生成脚本把包清单汇总进
// src/levelPacks.generated.ts（提交入库，与 levelData.generated 同一路线），核心代码只认本文件。
// 包规则：①index.ts 顶层只组装描述符，不得调用 levels/machines 的函数（模块求值期关卡目录尚未就绪）；
// ②生成器在编译期、钩子在事件期运行，都不得依赖 levels 目录本身；③对 machines.ts 只做 type import
// （防运行时循环依赖）；④包内组件键应避开基础目录的 architecture-* 前缀，防止与规范教学组件同名。
import type { Level } from './levels';
import type { CaseGenerator, ScenarioGenerator } from './levelGenerators';
import type { MachineDescriptor } from './machines';
import { caseGenerators as baseCaseGenerators, scenarioGenerators as baseScenarioGenerators } from './levelGenerators';
import { generatedLevelPacks } from './levelPacks.generated';

/** 关卡钩子事件：JSON 的 hooks 段按键声明、以 "包键/钩子名" 引用包内实现。 */
export const LEVEL_EVENTS = ['onEnter', 'onFirstClear', 'onFirstFail'] as const;
export type LevelEvent = typeof LEVEL_EVENTS[number];
export interface LevelHooks { onEnter?: string; onFirstClear?: string; onFirstFail?: string; }

/** 钩子运行上下文：只能经这两个通道产生可见效果，不能触碰电路、判题与存档其他字段。 */
export interface HookContext {
  level: Level;
  notify(text: string): void;
  showMessage(title: string, body: string): void;
}
export type LevelHook = (context: HookContext) => void;

/** 一捆可独立新增的内容：关卡 JSON、追加章节、生成器、钩子与可选的新计算机。 */
export interface LevelPack {
  /** 包键 = 文件夹名；JSON 里的生成器/钩子引用以 "包键/名字" 命名空间，避免与基础目录或其他包冲突。 */
  key: string;
  /** 包内关卡的全局 id = idBase + JSON id（固定值，不随版本变化）；关卡 id 只需在本包内唯一。
   *  编译期守卫保证各包区间互不相交、且整体位于基础目录之上。 */
  idBase: number;
  /** 追加的章节标题，编号接在基础 7 章之后。 */
  chapters?: string[];
  scenarioGenerators?: Map<string, ScenarioGenerator>;
  caseGenerators?: Map<string, CaseGenerator>;
  /** 包内机器的 sourceLevel 按包内编号书写，合并进注册表时翻译为全局 id。 */
  machines?: MachineDescriptor[];
  hooks?: Map<string, LevelHook>;
}

const PACK_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
// 启动期校验生成清单：声明的 key 必须与文件夹一致，形状必须合法（守卫生成脚本与手写漂移）。
export const levelPacks: readonly LevelPack[] = generatedLevelPacks.map(({ folder, pack }) => {
  if (!pack || typeof pack !== 'object') throw new Error(`关卡包 ${folder} 缺少 pack 描述符。`);
  if (pack.key !== folder) throw new Error(`关卡包 ${folder} 声明的 key 是“${String(pack.key)}”，必须与文件夹同名。`);
  if (!PACK_KEY.test(pack.key)) throw new Error(`关卡包键“${pack.key}”不合法（仅小写字母、数字与连字符）。`);
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
