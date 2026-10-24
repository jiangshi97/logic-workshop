# 关卡编写指南（LevelSpec / JSON）

> **新手请先读 [关卡编写完全指南（HTML）](level-authoring.html)**：面向"只懂玩法与 TypeScript"的完整教程，
> 含逐步上手、全部字段细则、表达式文法、生成器/钩子 API、踩坑报错速查表。本文件是精简速查版。

本文面向要给「逻辑工坊」新增关卡的作者。**全部 56 个基础关卡都用这里的格式编写**（`content/levels/*.json`）：
文案、端口、提示、判题期望（表达式 / 帧时间线 / 数学用例）全部是数据，不需要触碰任何判题或仿真代码。
固定机器与教学组件的**电路**（第 44 关整机、`architecture-*` 教学组件）仍以代码维护，
那是元件库，不是关卡定义。

**新增关卡一律写进"关卡包"**（`content/packs/<包名>/`，见下文[关卡包](#关卡包新增关卡的入口)一节）：
关卡 JSON、专属生成器/钩子/新计算机的 TypeScript 全部放在包目录里，核心代码零修改。
基础目录 `content/levels/` 保持冻结——不要在里面追加或改动关卡。

- 目录：基础 `content/levels/*.json` + 各包 `content/packs/*/levels/*.json`，文件名 `编号-英文短名.json`，聚合按 `id` 排序。
- 加载：`npm run regen:levels` 扫描两个目录，生成 `src/levelData.generated.ts` 与 `src/levelPacks.generated.ts`
  （纯 TS 静态导入，Vite/vitest/Playwright 通用），`src/levelRegistry.ts` 统一校验编译；忘记再生成时测试会直接报出。
- 校验：`src/levelSpec.ts` 的 `compileLevelSpec()` 做全部运行时校验（结构、端口、位宽、表达式、取值范围），
  任何错误都会抛出带关卡号与文件路径的中文信息，`npm test` 会在测试阶段第一时间暴露。
- 判题：编译产物就是内部 `Level` 对象，判题/仿真/UI 完全无感；期望值仍是**独立数学定义**，不经任何电路。

## 快速开始

新增一关只需五步：

1. 新建（或复用）一个关卡包目录 `content/packs/我的包名/`，包内新建 `levels/001-my-level.json`。
2. 填入下方任意一个完整示例的结构并改成你的内容（`id` 只要在**本包内**唯一即可，从 1 编起）。
3. 在包的 `index.ts` 里登记包描述符（`key` = 文件夹名、`idBase` 一个固定正整数、可选的章节与扩展点，
   抄 `content/packs/useful-computer/index.ts` 即可）。
4. 运行 `npm run regen:levels` 重新生成两个生成文件（编译期静态导入，Vite/vitest/Playwright 通用）。
5. 运行 `npm test`——校验错误、编号冲突、区间相交、期望值快照变化、忘记再生成都会在这里报出来；再 `npm run dev` 试玩。

追加关卡建议 `chapter` 填 7（编程应用，列表末尾）或在包里声明新章节（编号接在基础 7 章之后）；
侧栏按章节分组展示，编号很大的关卡放在早期章节组里会显得突兀。

## 字段参考

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | 正整数 | ✓ | 基础目录：全局唯一且按 id 排序；关卡包：**仅本包内唯一**，全局 id = `idBase + id`（见关卡包一节） |
| `title` / `caption` | string | ✓ | 名称与副标题（侧栏/标题栏展示） |
| `goal` | string | ✓ | 任务描述正文 |
| `formula` | string | ✓ | 数学公式（如 `Sum = A ⊕ B`） |
| `chapter` | 正整数 | ✓ | 章节号；上限 = 基础 7 章 + 各包追加的章节数（编译期校验） |
| `inputs` / `outputs` | `[端口名, 位宽][]` | ✓ | 接口端口；端口名是合法标识符，不可用保留字 `div`/`mod`，位宽 1–32 |
| `allowed` | 门型数组 | — | 本关可用门型。省略时：1–20 号按解锁表推导，其余取全部门型 |
| `hints` | string[3] | ✓ | 恰好三条递进提示 |
| `rewardName` | string | — | 通关后可把整关电路打包成组件的默认命名 |
| `defaultProgram` | number[] | — | ROM 初始指令字（最多 256 个 16 位字） |
| `hooks` | 对象 | — | 关卡钩子声明（仅关卡包有意义）：`{ 事件名: "包名/钩子名" }`，9 个事件见关卡包一节 |
| `combinational` / `sequential` / `program` | 对象 | 三选一 | 判题模式段，必须恰好提供一个 |

## 表达式语言（组合关期望值）

纯整数运算，无函数调用与属性访问；运算符优先级与 C 一致（从低到高）：

```
三目      a ? b : c
位或      |
位异或    ^
位与      &
相等      =  !=
关系      <  <=  >  >=        （结果为 1 或 0）
移位      << >>
加减      +  -
乘除      *  div  mod          （div/mod 是保留字）
一元      -  ~
```

- `div` 是向下取整除法；`mod` 是与除数同号的数学取模——`(A - B) mod 16` 在 A<B 时直接得到补码结果。
- 结果会自动按输出端口位宽取模（`~(A & B)` 接 1 位输出自动变成 0/1）。
- 除零在求值时抛错；引用未声明的端口名在编译期报错。
- 复杂译码逻辑可用三目链 + 位运算表达，参见第 37/40 关（指令格式 / 指令控制器）的 `expect`。

## 完整示例

### 组合关——表达式（第 20 关原文）

```json
{
  "id": 20,
  "title": "四位减法",
  "caption": "补码与借位",
  "goal": "Diff 是 A−B 的四位结果；A 小于 B 时 Borrow 为 1。",
  "formula": "Diff = (A − B) mod 16；Borrow = (A < B)",
  "chapter": 4,
  "inputs": [["A", 4], ["B", 4]],
  "outputs": [["Diff", 4], ["Borrow", 1]],
  "hints": [
    "减法可转为 A 加上 B 的反码再加 1。",
    "每一位反转 B，把初始进位设为 1。",
    "四位相加的 Sum 就是 Diff；最高位 Cout 反转后得到 Borrow。"
  ],
  "rewardName": "Subtract4",
  "combinational": { "expect": { "Diff": "(A - B) mod 16", "Borrow": "A < B" } }
}
```

### 组合关——真值表（小输入空间的可读写法）

```json
"combinational": {
  "truthTable": [
    { "inputs": { "A": 0, "B": 0 }, "outputs": { "Y": 1 } },
    { "inputs": { "A": 0, "B": 1 }, "outputs": { "Y": 1 } },
    { "inputs": { "A": 1, "B": 0 }, "outputs": { "Y": 1 } },
    { "inputs": { "A": 1, "B": 1 }, "outputs": { "Y": 0 } }
  ]
}
```

`expect` 与 `truthTable` 二选一。省略 `cases` 时判题自动穷举全部输入组合；输入空间大时可给公开测试集：
`"cases": [{ "A": 0, "B": 1 }]`（每项必须覆盖全部输入端口）。第 33/34/40 关的公开用例集是
`"cases": { "generator": "alu-cases" }` 这样的生成器引用（见下文「生成器」）。

### 时序关——帧时间线

每步 `inputs` 可省略端口（缺省 0），`tick` 缺省 `true`（推进一个时钟沿）；`expected` 必须覆盖全部输出端口。

```json
{
  "id": 21,
  "title": "记住一个信号",
  "caption": "第一次跨越时间",
  "goal": "初始 Q=0。改变 D 时 Q 保持；每次时钟沿后 Q 记住当前 D。",
  "formula": "沿上 Q ← D；无沿保持",
  "chapter": 5,
  "inputs": [["D", 1]],
  "outputs": [["Q", 1]],
  "allowed": ["NAND", "NOT", "AND", "OR", "XOR", "XNOR", "SPLIT", "JOIN", "CONST", "DFF"],
  "hints": ["…", "…", "…"],
  "sequential": {
    "scenarios": [
      {
        "label": "写入与保持",
        "steps": [
          { "inputs": { "D": 1 }, "tick": false, "expected": { "Q": 0 } },
          { "inputs": { "D": 1 }, "expected": { "Q": 1 } },
          { "inputs": { "D": 0 }, "tick": false, "expected": { "Q": 1 } }
        ]
      }
    ]
  }
}
```

场景可以带 `program`（最多 256 个 16 位指令字），为该场景预置 ROM——取指/整机关（38/44）靠它逐场景换程序。

第 21–44 关的现有场景引用命名生成器（`"sequential": { "generator": "temporal" }` 或 `"architecture"`）：
覆盖回绕、同沿读写旧值等海量边角帧的穷举数据由 `src/levelGenerators.ts` 的独立参考状态机在编译期展开，
JSON 保持人可编写的小体积。手写新关卡建议保持步数可控，帧的期望值可先用参考电路在工坊里跑出来再誊写；
需要同类穷举覆盖时也可复用/新增生成器（展开数据与手写数据走完全相同的校验，并被内容快照的摘要守卫盯住）。

### 生成器——JSON 与 TS 函数结合

穷举判题数据（数千帧场景、上万条用例）不适合手写也不适合塞进 JSON。关卡可以用生成器引用代替字面量，
JSON 只保留人写的内容与一个名字，编译期由 `src/levelGenerators.ts` 展开成具体数据并走同一套校验：

| 引用写法 | 展开内容 | 现有使用 |
|---|---|---|
| `"sequential": { "generator": "temporal" }` | 时序参考状态机 `temporalOracle` 的穷举帧（数据改变/重复采样/保持、回绕、同沿读写旧值、单元隔离、复位优先） | 第 21–32 关 |
| `"sequential": { "generator": "architecture" }` | `architectureOracle` 的场景帧，含逐场景 ROM 程序 | 第 35–44 关的时序关 |
| `"cases": { "generator": "alu-cases" }` | 每个 A 配边界伙伴集 × 全部运算选择的公开用例 | 第 33/34 关 |
| `"cases": { "generator": "controller-cases" }` | 全部合法/非法指令字 × Z × Phase 的公开用例 | 第 40 关 |

期望值仍由独立数学模型（`temporalOracle` / `architectureOracle`）计算，不经任何电路或仿真器；
展开结果的判题摘要固化在内容快照里，改生成器代码与改 JSON 一样会被 `npm test` 拦下。
新增生成器：在 `levelGenerators.ts` 写一个 `(context) => ScenarioSpec[] | Inputs[]` 函数并注册进
`scenarioGenerators` / `caseGenerators`，JSON 即可按名引用。

### 编程关——数学用例

用例的 `memory` 键是 "0"–"255" 的地址字符串；`expectedOutput` 是完整 OUT 序列；`maxCycles` 是周期预算。
判题在真实门级 CPU 上执行玩家的 ROM，期望值只来自这里的数学定义。

```json
{
  "id": 56,
  "title": "…", "caption": "…", "goal": "…", "formula": "OUT = (3n) mod 256",
  "chapter": 7,
  "inputs": [["In", 8]], "outputs": [["Out", 8]],
  "hints": ["…", "…", "…"],
  "program": {
    "cases": [
      { "label": "RAM[240]=7", "memory": { "240": 7 }, "expectedOutput": [21], "maxCycles": 400 }
    ],
    "referenceSource": "MOVI A, 1\nHLT"
  }
}
```

第 45–56 关的用例与参考汇编源就是此格式（`referenceSource` 供测试与示例存档对照）。
提供 `program` 段即自动判定为编程关，判题与初始整机电路的关卡带从数据派生，无需改任何代码。

编程关还可以加可选的 `"machine": "computer-44"`（`program` 段的键），把该关绑定到机器注册表
（`src/machines.ts`）中的某台计算机：初始电路用该机的整机、汇编源只能使用该机支持的指令子集。
省略时默认绑定注册表第一台；值必须是注册表里已存在的 key，否则 `levelSpec` 校验报错。
玩家在通关该机的 `sourceLevel` 后，可在编程面板顶部的机器选择器中切换已解锁的计算机。
**新计算机也可以由关卡包注册**（见下节 `machines` 扩展点）。

## 关卡包：新增关卡的入口

一个关卡包 = `content/packs/<包名>/` 一个目录，承载一捆可独立新增的内容：

```
content/packs/我的扩展/
  index.ts        # 包描述符（唯一必需文件）：key / idBase / chapters / 各扩展点
  levels/*.json   # 关卡数据（格式与上文完全相同；id 为包内编号）
  其余 TS 自由组织 # 生成器、钩子、机器电路、参考实现……index.ts 引它们
```

`index.ts` 导出一个 `pack: LevelPack` 描述符（类型从公共 API 包导入）：

```ts
import type { LevelPack } from 'logic-level-api';

export const pack: LevelPack = {
  key: '我的扩展',      // 必须与文件夹同名；JSON 里的引用都用它做命名空间（"我的扩展/xxx"）
  idBase: 100,          // 包内关卡的全局 id = idBase + JSON id。选一个远离基础目录（当前止于 56）的固定值，永不改动
  chapters: ['指令集扩展'],  // 可选：追加章节（编号接在基础 7 章之后）
  // 以下全部可选，按需注册：
  // scenarioGenerators: new Map([['场景生成器名', fn]]),
  // caseGenerators: new Map([['用例生成器名', fn]]),
  // machines: [新计算机描述符（sourceLevel 写包内编号）],
  // hooks: new Map([['钩子名', fn]]),
};
```

### 编号规则（不用关心全局计数）

- 关卡 JSON 的 `id` **只需在本包内唯一**，从 1 编起、允许跳号；全局 id 由 `idBase + id` 推导。
- `idBase` 是一次性决定：必须使包内全部关卡都大于基础目录最大关卡号（当前 56），且与其他包的区间不相交
  ——编译期守卫（`src/levelRegistry.ts`）违反即报错并列出冲突双方。相邻包留出足够间隔（如 100 / 200）。
- 存档、判题、解锁全部使用推导后的全局 id，**稳定不随版本变化**（所以 idBase 定了就不要改）。
- 侧栏显示的"第 N 关"、解锁进度、"下一关"一律按**目录位置**计算（`src/progress.ts`），
  与 id 数值无关——全局 id 101 的关卡显示为第 58 关。

### JSON 引用包内 TypeScript 的三种方式

沿用 `program.machine` 的惯例：JSON 只写字符串键，编译期校验形状，运行期向注册表解析。

1. **生成器**（穷举判题数据，见上文生成器一节）：

   ```json
   "sequential": { "generator": "我的扩展/场景生成器名" }
   "combinational": { "cases": { "generator": "我的扩展/用例生成器名" } }
   ```

   裸名（如 `"temporal"`）保留给基础目录的 `levelGenerators.ts`。生成器收到
   `{ id: 全局id, pack, localId, inputPorts, outputPorts }` 上下文，按 `localId` 分派即可。

2. **钩子**（事件驱动的特殊行为，如"第一次通关后执行特殊行为"）：

   ```json
   "hooks": {
     "onFirstClear": "我的扩展/通关彩蛋",
     "onFirstHint":  "我的扩展/提示引导",
     "onEveryTest":  "我的扩展/教练"
   }
   ```

   可用事件共 9 个：**一次性**（每关至多触发一次，记录随存档持久化、导入/刷新不重放）
   `onEnter` 首次进入 / `onFirstHint` 首次展开提示 / `onAllHints` 提示全部展开 / `onFirstFail` 首次判题失败 /
   `onFirstClear` 首次通关 / `onFirstPackage` 首次把本关电路保存为组件 / `onFirstProgramApply` 编程关首次应用汇编；
   **周期性**（每次都触发，不持久化）`onEveryEnter` 每次进入 / `onEveryTest` 每次判题结束（携带 `test` 报告）。
   钩子是普通函数，经上下文 API 产生可见效果（toast / 弹窗 / 本关私有 store / 进度与目录查询）：

   ```ts
   import type { HookContext } from 'logic-level-api';
   const 通关彩蛋 = ({ level, showMessage, store }: HookContext) => {
     store.set('clearedAt', new Date().toISOString());   // 本关私有，随存档持久化
     showMessage('新指令解锁', `「${level.title}」通关！接下来可以试试 AND 指令。`);
   };
   ```

   完整 API（含进度查询、判题报告、种子随机工具）见 [logic-level-api](../packages/level-api/README.md)。

3. **机器**：编程关的 `program.machine` 填包内注册的机器 key。包机器的 `sourceLevel` 写**包内编号**，
   装载时自动翻译成全局 id；玩家通关来源关后即在机器选择器中解锁。机器的整机电路与依赖闭包
   在包内用 `architectureCircuits.ts` 导出的 `Builder` DSL 与 `dependencyClosure()` 构建。

### 包规则（防止踩到装载链路）

- `index.ts` 顶层只组装描述符，**不要调用** `levels` / `machines` 模块的函数——模块求值期关卡目录尚未就绪；
  机器的 `circuit()` / `library()` 本来就是回调，在回调里调用没问题。
- 生成器与钩子不得依赖 `levels` 目录（生成器在编译期触发，钩子只拿得到传入的 level）。
- 对 `src/machines.ts` 只做 `import type`（防运行时循环依赖）；其余核心模块随意。
- 包内自定义组件的键避开基础目录的 `architecture-*` 前缀，防止与规范教学组件同名覆盖。

`content/packs/useful-computer/` 是当前仓库里常驻的真实关卡包（含一个六运算 ALU 关卡 `levels/001-alu-plus.json`，
演示包内编号、idBase 平移、追加章节、用例生成器与 `onEnter` 开场钩子的完整接线），
生成器/钩子的写法直接抄它。

## 工作流与守卫

- `npm test`：JSON 校验、全局编号唯一、包区间不相交、章节/提示/端口不变量，以及 `tests/level-content.test.ts`
  的内容快照与生成文件同步检查——第 1–20 关固化**全部穷举期望值**，所有关卡固化判题数据摘要
  （输入集/场景帧/编程用例的条数与 sha1）。改动**已有**关卡判题数据时快照会失败，确认是设计意图后用
  `UPDATE_SNAPSHOTS=1 npx vitest run tests/level-content.test.ts` 重新生成。
  `tests/level-packs.test.ts` 覆盖关卡包守卫（idBase 推导/区间相交/机器翻译）与生成器/钩子解析。
- `npm run dev` 试玩；通关、判题、波形、提示对任意模式的关卡完全同构。

## TS 入口（程序化场景）

需要在代码里组装 spec（例如测试构造或批量生成）时，可用类型化包装走同一个编译器：

```ts
import { defineLevel } from './levelSpec';
const myLevel = defineLevel({ /* 与 JSON 同构的 LevelSpec 对象 */ });
```

关卡目录本身只认 `content/levels/*.json`；`defineLevel` 的产物不会进入聚合数组。
