// 关卡钩子事件目录：关卡 JSON 的 hooks 段只能引用这里列出的键。
// 一次性（once）事件每关只触发一次，触发记录写入存档（firedHooks）防重放；
// 周期性（recurring）事件每次发生都触发，不持久化。LEVEL_EVENTS 是一次性事件的别名，
// 存档解析只接受它（周期性事件没有触发记录）。

/** 一次性事件：onEnter 首次进入本关 / onFirstHint 展开第一条提示 / onAllHints 三条提示全部展开 /
 *  onFirstFail 首次判题未通过 / onFirstClear 首次判题通过 / onFirstPackage 首次把本关电路保存为组件 /
 *  onFirstProgramApply 编程关首次成功应用汇编。 */
export const ONCE_LEVEL_EVENTS = ['onEnter', 'onFirstHint', 'onAllHints', 'onFirstFail', 'onFirstClear', 'onFirstPackage', 'onFirstProgramApply'] as const;
export type OnceLevelEvent = typeof ONCE_LEVEL_EVENTS[number];

/** 周期性事件：onEveryEnter 每次进入本关（含首次，排在 onEnter 之后）/ onEveryTest 每次判题结束后。 */
export const RECURRING_LEVEL_EVENTS = ['onEveryEnter', 'onEveryTest'] as const;
export type RecurringLevelEvent = typeof RECURRING_LEVEL_EVENTS[number];

export const LEVEL_HOOK_KEYS = [...ONCE_LEVEL_EVENTS, ...RECURRING_LEVEL_EVENTS] as const;
export type LevelHookKey = typeof LEVEL_HOOK_KEYS[number];

/** 一次性事件的别名（存档 firedHooks 只记录这些）。 */
export const LEVEL_EVENTS = ONCE_LEVEL_EVENTS;
export type LevelEvent = OnceLevelEvent;

export const isOnceLevelEvent = (event: LevelHookKey): event is OnceLevelEvent =>
  (ONCE_LEVEL_EVENTS as readonly string[]).includes(event);
