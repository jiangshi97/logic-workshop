// LevelPack 描述符：一个关卡包 = content/packs/<key>/ 目录的全部扩展点。
// 类型从宿主 src 平移引用（type-only，运行期无循环依赖）；运行时解析在 src/levelPack.ts。
import type { LevelHook } from './hooks';
import type { ScenarioGenerator, CaseGenerator } from '../../../src/levelGenerators';
import type { MachineDescriptor } from '../../../src/machines';

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
