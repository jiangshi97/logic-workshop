// 进度与关卡序号：解锁链沿目录**位置**推进，关卡 id 只是稳定身份、不是序号。
// 基础目录 1..57 连续（位置 + 1 == id），因此对现有目录这些助手与旧的"id 当序号"语义完全等价；
// 关卡包引入稀疏 id（如 101）后，"第 N 关"的显示、锁定与"下一关"一律取位置。
import { levels } from './levels';

export interface ProgressHelpers {
  /** 关卡在目录中的位置（0 起）；不在目录返回 -1。 */
  levelPosition(id: number): number;
  /** 展示序号"第 N 关"= 位置 + 1，与 id 数值无关。 */
  displayNumber(id: number): number;
  /** 已通关数 → 可玩关数（含前沿那一关）。 */
  unlockedCount(done: number): number;
  /** 该关当前是否可进入（位置在解锁前沿之内）。 */
  isUnlocked(id: number, done: number): boolean;
  /** 该关是否已通关（位置在已通关前缀内）；id 不在目录时恒为 false。 */
  isCleared(id: number, done: number): boolean;
  /** 目录中的下一关 id；已是最后一关返回 undefined。 */
  nextLevelId(id: number): number | undefined;
  /** 解锁前沿关 id（第 done+1 关；全部通关时即最后一关）。 */
  frontierLevelId(done: number): number;
}

/** 按目录构造进度助手（导出供测试用稀疏目录验证语义；应用侧绑定真实目录）。 */
export function makeProgress(catalogue: readonly { id: number }[]): ProgressHelpers {
  const positions = new Map(catalogue.map((level, index) => [level.id, index] as const));
  const count = catalogue.length;
  const levelPosition = (id: number): number => positions.get(id) ?? -1;
  const unlockedCount = (done: number): number => Math.min(count, done + 1);
  return {
    levelPosition,
    displayNumber: id => levelPosition(id) + 1,
    unlockedCount,
    isUnlocked: (id, done) => { const position = levelPosition(id); return position >= 0 && position < unlockedCount(done); },
    isCleared: (id, done) => { const position = levelPosition(id); return position >= 0 && position < done; },
    nextLevelId: id => catalogue[levelPosition(id) + 1]?.id,
    frontierLevelId: done => catalogue[Math.min(unlockedCount(done), count) - 1]?.id ?? catalogue[0].id,
  };
}

const progress = makeProgress(levels);
export const levelPosition = progress.levelPosition;
export const displayNumber = progress.displayNumber;
export const unlockedCount = progress.unlockedCount;
export const isUnlocked = progress.isUnlocked;
export const isCleared = progress.isCleared;
export const nextLevelId = progress.nextLevelId;
export const frontierLevelId = progress.frontierLevelId;
