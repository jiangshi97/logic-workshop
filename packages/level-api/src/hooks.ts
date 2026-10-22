// 钩子运行上下文：关卡包 TypeScript 在事件期拿到的全部 API。
// 约束：只能通过这里的通道产生可见效果（消息/弹窗/本关私有 store），
// 不直接触碰电路、判题管线或存档其他字段——这些由宿主应用注入实现。
import type { Level } from '../../../src/levels';
import type { LevelHookKey } from './events';

/** 判题结果快照：onEveryTest / onFirstFail / onFirstClear 触发时提供。 */
export interface TestReport {
  passed: boolean;
  /** 未通过时的失败现场：触发不一致的输入值与被定位的输出端口。 */
  failure?: { inputs: Record<string, number>; mismatches: string[] };
}

/** 进度查询（只读）。不带参数时默认作用于触发钩子的那一关。 */
export interface ProgressApi {
  /** 已通关数（连续证明链长度口径与界面总进度一致）。 */
  done(): number;
  /** 目录关卡总数。 */
  total(): number;
  isCleared(levelId?: number): boolean;
  isUnlocked(levelId?: number): boolean;
  /** 展示编号（侧栏「第 N 关」的 N，按目录位置而非全局 id）。 */
  displayNumber(levelId?: number): number;
  /** 下一关 id；已是末关时为 undefined。 */
  nextLevelId(levelId?: number): number | undefined;
}

/** 关卡目录只读视图：get 按全局 id（包关卡 id = idBase + 包内编号）。 */
export interface CatalogApi {
  get(levelId: number): Level | undefined;
  all(): readonly Level[];
  chapters(): readonly string[];
}

/** 本关私有持久化键值 store：随存档（v7 的 packState 字段）保存，导入/刷新后仍在。
 *  值必须可 JSON 序列化；读取反映的是最近一次已提交的状态（同一次调用里先 set 后 get 读到旧值）。 */
export interface LevelStore {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(): string[];
}

/** 触发时刻本关草稿电路的规模统计（只读）。 */
export interface DraftStats {
  nodes: number;
  wires: number;
}

export interface HookContext {
  /** 触发本钩子的关卡（编译后的完整 Level）。 */
  level: Level;
  /** 触发事件名。 */
  event: LevelHookKey;
  /** 右下角 toast 通知。 */
  notify(text: string): void;
  /** 模态消息框（玩家点「知道了」关闭）。 */
  showMessage(title: string, body: string): void;
  progress: ProgressApi;
  catalog: CatalogApi;
  store: LevelStore;
  draft: DraftStats;
  /** 判题类事件（onEveryTest / onFirstFail / onFirstClear）携带的结果。 */
  test?: TestReport;
}

export type LevelHook = (context: HookContext) => void;

/** 关卡 JSON 的 hooks 段：事件名 → "包键/钩子名"。 */
export type LevelHooks = Partial<Record<LevelHookKey, string>>;
