# logic-level-api —— 关卡包 TypeScript API

「逻辑工坊」关卡包（`content/packs/<包名>/`）里全部 TypeScript 面对的公共 API：
**事件钩子目录、钩子运行上下文（notify / 弹窗 / 进度查询 / 关卡目录 / 本关私有 store / 判题报告）、
LevelPack 描述符类型与纯工具**。宿主应用与关卡包都从同一个名字导入：

```ts
import { type LevelPack, type LevelHook, rng, range } from 'logic-level-api';
```

- 别名 `logic-level-api` 由仓库统一解析（tsconfig `paths`、vite/vitest `resolve.alias`、npm workspaces 链接），包源码在 `packages/level-api/src/`，无需安装。
- 关卡编写的完整流程（目录布局、包内编号、生成器/机器接线）见 [docs/level-authoring.md](../../docs/level-authoring.md)；本文件只讲 TS API。

## 1. 钩子事件目录

关卡 JSON 的 `hooks` 段声明「事件 → "包键/钩子名"」；`index.ts` 的 `hooks: Map<string, LevelHook>` 注册实现。

| 事件 | 触发时机 | 次数 | `ctx.test` |
|---|---|---|---|
| `onEnter` | 首次进入本关 | 一次（存档记录） | — |
| `onEveryEnter` | 每次进入本关（含首次，排在 onEnter 后） | 每次 | — |
| `onFirstHint` | 玩家首次展开提示 | 一次（存档记录） | — |
| `onAllHints` | 三条提示全部展开的那一刻 | 一次（存档记录） | — |
| `onFirstFail` | 本关首次判题未通过 | 一次（存档记录） | ✓ |
| `onFirstClear` | 本关首次判题通过 | 一次（存档记录） | ✓ |
| `onFirstPackage` | 首次把本关电路「保存为组件」（整关打包） | 一次（存档记录） | — |
| `onFirstProgramApply` | 编程关首次成功「应用汇编」 | 一次（存档记录） | — |
| `onEveryTest` | 每次判题结束后（通过与否都触发） | 每次 | ✓ |

- **一次性事件**的触发记录写入存档（`firedHooks` 字段），刷新/导入后不会重放；记录丢失最多导致再触发一次，无副作用风险。
- **周期性事件**没有触发记录，每次都执行——适合做阶段化引导、失败计数等有状态脚本（配合 `store`）。
- 事件目录即类型：`ONCE_LEVEL_EVENTS` / `RECURRING_LEVEL_EVENTS` / `LEVEL_HOOK_KEYS`，`isOnceLevelEvent(event)` 可在运行期判别。
- JSON 里写未知事件键在编译期报错（`levelSpec` 校验）；引用了未注册的钩子在运行期以 toast 提示，不会崩溃。

```json
{ "hooks": { "onFirstClear": "mypack/finale", "onEveryTest": "mypack/coach" } }
```

## 2. HookContext —— 钩子能调用的全部 API

```ts
export type LevelHook = (context: HookContext) => void;
```

| 成员 | 说明 |
|---|---|
| `level: Level` | 触发事件的那一关（编译后的完整关卡对象：端口、提示、判题模式等，只读） |
| `event: LevelHookKey` | 本次触发的事件名（同一实现可复用于多个事件） |
| `notify(text)` | 右下角 toast 通知（自动消失） |
| `showMessage(title, body)` | 模态消息框，玩家点「知道了」关闭 |
| `progress` | 进度查询（见下） |
| `catalog` | 关卡目录只读视图（见下） |
| `store` | 本关私有持久化键值（见下） |
| `draft` | `{ nodes, wires }`：触发时刻本关草稿电路的规模统计 |
| `test?` | 判题报告，仅判题类事件提供（见上表） |

### progress（只读，缺省作用于本关）

```ts
progress.done()                    // 已通关数（与界面总进度同口径）
progress.total()                   // 目录关卡总数
progress.isCleared(levelId?)       // 该关是否已有通关证明
progress.isUnlocked(levelId?)      // 该关是否已解锁
progress.displayNumber(levelId?)   // 侧栏「第 N 关」的 N（按目录位置，不是全局 id）
progress.nextLevelId(levelId?)     // 下一关 id；末关为 undefined
```

### catalog（只读）

```ts
catalog.get(levelId)   // Level | undefined（包关卡按全局 id = idBase + 包内编号查询）
catalog.all()          // 全部关卡（目录顺序）
catalog.chapters()     // 章节标题（基础 7 章 + 各包追加）
```

### store —— 本关私有、随存档持久化

```ts
store.get<T>(key)      // T | undefined
store.set(key, value)  // 值必须可 JSON 序列化
store.delete(key)
store.keys()
```

- 存进存档 v7 的 `packState` 字段（`{ 关卡id: { 键: 值 } }`）；刷新、导入导出后仍在，每关互相隔离。
- 键限 `1–64` 个字符且不含空白（下划线、大写与中文均可）；单个值 ≤ 64 KiB、单关总量 ≤ 256 KiB（超限抛错，被钩子外层捕获后以 toast 报告）。
- 读取反映最近一次已提交的状态：同一次调用里先 `set` 后 `get` 读到的是旧值（写穿透、下一事件可见）。

### test —— 判题报告

```ts
ctx.test?.passed                    // boolean
ctx.test?.failure?.inputs           // 触发不一致的输入值，如 { A: 3, B: 5 }
ctx.test?.failure?.mismatches      // 被定位的输出端口名，如 ['Diff']
```

## 3. 综合示例：有状态的教练钩子

```ts
import type { HookContext, LevelHook } from 'logic-level-api';

const coach: LevelHook = ({ level, notify, showMessage, store, test, progress, draft }: HookContext) => {
  if (!test) return;                                  // 只关心判题事件
  if (test.passed) {
    if (!store.get('bestNodes')) store.set('bestNodes', draft.nodes);   // 记录首次通关时的规模
    showMessage('漂亮！', `「${level.title}」通过，用了 ${draft.nodes} 个节点。下一关：第 ${progress.displayNumber(progress.nextLevelId()!)} 关。`);
    return;
  }
  const fails = (store.get<number>('fails') ?? 0) + 1;
  store.set('fails', fails);
  if (fails === 2) notify('再想想进位链的方向。');
  if (fails >= 4) notify(`已失败 ${fails} 次，揭示输出：${test.failure?.mismatches.join('、')}。`);
};

const intro: LevelHook = ({ notify, catalog }) => {
  const prev = catalog.get(900);                      // 同包上一关（假设 idBase 900）
  if (prev) notify(`上一关「${prev.title}」的减法器在这里能直接复用。`);
};
```

JSON：`"hooks": { "onEveryTest": "mypack/coach", "onFirstClear": "mypack/intro" }`
（`coach` 挂 `onEveryTest` 时通过分支只跑一次逻辑由 `store` 保证——`onFirstClear` 只触发一次，两者可自由组合。）

## 4. 生成器与工具（编译期）

JSON 的 `"generator": "包键/名字"` 引用包内生成器，编译期展开穷举判题数据；上下文与工具：

```ts
import { rng, range, type ScenarioGenerator } from 'logic-level-api';

const randomWalk: ScenarioGenerator = ({ id, inputPorts, outputPorts, pack, localId }) => {
  const next = rng(id * 7919);                        // 种子随机：跨机器、跨版本完全一致
  return range(8).map(index => ({
    label: `游走 ${index + 1}`,
    steps: [{ inputs: { D: Math.floor(next() * 16) }, expected: { /* 参考模型 */ Q: 0 } }],
  }));
};
```

- `GeneratorContext`：`{ id（全局）, inputPorts, outputPorts, pack?, localId? }`。
- `rng(seed)`（mulberry32）与 `range(n)` 无宿主依赖；判题数据必须确定性，禁止 `Math.random()`。

## 5. LevelPack 描述符与机器

`index.ts` 顶层只组装描述符（不调用宿主运行时函数）；机器的 `circuit()/library()` 在回调里调用核心助手：

```ts
import type { LevelPack } from 'logic-level-api';

export const pack: LevelPack = {
  key: 'mypack',            // = 文件夹名
  idBase: 1000,             // 本包全局 id = 1000 + 包内 JSON id（固定不再变）
  chapters: ['扩展架构'],    // 可选：追加章节
  scenarioGenerators: new Map([...]),
  caseGenerators: new Map([...]),
  hooks: new Map([...]),
  machines: [...],          // MachineDescriptor；sourceLevel 写包内编号，合并时自动翻译
};
```

循环防护规则（编译期由目录结构保证，详见 authoring 指南）：`index.ts` 顶层不得调用 `levels`/`machines` 的函数；生成器与钩子不得依赖关卡目录；对 `src/machines.ts` 只做 `import type`。

## 6. 兼容性

- 存档版本仍为 v7：`firedHooks` 与 `packState` 都是加法字段——老档缺省（未触发 / 空 store），旧版本应用读到会忽略。
- 一次性事件记录里只认编译进目录的事件名；存档里的未知事件/未知关卡键在导入时被静默丢弃。
