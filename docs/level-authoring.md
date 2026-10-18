# 关卡编写指南（LevelSpec / JSON）

本文面向要给「逻辑工坊」新增关卡的作者。**全部 57 关都用这里的格式编写**（`content/levels/*.json`）：
文案、端口、提示、判题期望（表达式 / 帧时间线 / 数学用例）全部是数据，不需要触碰任何判题或仿真代码。
固定机器与教学组件的**电路**（第 44 关整机、`architecture-*` 教学组件）仍以代码维护，
那是元件库，不是关卡定义。

- 目录：`content/levels/`，文件名 `三位关卡号-英文短名.json`（如 `015-half-adder.json`），聚合按 `id` 排序。
- 加载：`npm run regen:levels` 由 `content/levels/*.json` 生成 `src/levelData.generated.ts`（纯 TS 静态导入，
  Vite/vitest/Playwright 通用），`src/levelRegistry.ts` 统一校验编译；忘记再生成时测试会直接报出。
- 校验：`src/levelSpec.ts` 的 `compileLevelSpec()` 做全部运行时校验（结构、端口、位宽、表达式、取值范围），
  任何错误都会抛出带关卡号与文件名的中文信息，`npm test` 会在测试阶段第一时间暴露。
- 判题：编译产物就是内部 `Level` 对象，判题/仿真/UI 完全无感；期望值仍是**独立数学定义**，不经任何电路。

## 快速开始

新增一关只需四步：

1. 在 `content/levels/` 新建 `058-my-level.json`（关卡号必须全局唯一且大于现有最大号）。
2. 填入下方任意一个完整示例的结构并改成你的内容。
3. 运行 `npm run regen:levels` 重新生成 `src/levelData.generated.ts`（编译期静态导入，Vite/vitest/Playwright 通用）。
4. 运行 `npm test`——校验错误、关卡号冲突、期望值快照变化、忘记再生成都会在这里报出来；再 `npm run dev` 试玩。

追加关卡建议 `chapter` 填 7（编程应用，列表末尾），除非内容确实属于更早的章节；
侧栏按章节分组展示，编号很大的关卡放在早期章节组里会显得突兀。

## 字段参考

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | 正整数 | ✓ | 关卡号，全局唯一。新关卡追加在现有最高号之后（当前 57+），聚合时按 id 排序 |
| `title` / `caption` | string | ✓ | 名称与副标题（侧栏/标题栏展示） |
| `goal` | string | ✓ | 任务描述正文 |
| `formula` | string | ✓ | 数学公式（如 `Sum = A ⊕ B`） |
| `chapter` | 1–7 | ✓ | 章节号；新增章节需同步扩 `levels.ts` 的 `chapters` 数组 |
| `inputs` / `outputs` | `[端口名, 位宽][]` | ✓ | 接口端口；端口名是合法标识符，不可用保留字 `div`/`mod`，位宽 1–32 |
| `allowed` | 门型数组 | — | 本关可用门型。省略时：1–20 号按解锁表推导，其余取全部门型 |
| `hints` | string[3] | ✓ | 恰好三条递进提示 |
| `rewardName` | string | — | 通关后可把整关电路打包成组件的默认命名 |
| `defaultProgram` | number[] | — | ROM 初始指令字（最多 256 个 16 位字） |
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
  "id": 57,
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

## 工作流与守卫

- `npm test`：JSON 校验、关卡号唯一、章节/提示/端口不变量，以及 `tests/level-content.test.ts` 的内容快照——
  第 1–20 关固化**全部穷举期望值**，所有关卡固化判题数据摘要（输入集/场景帧/编程用例的条数与 sha1）。
  改动**已有**关卡判题数据时快照会失败，确认是设计意图后用
  `UPDATE_SNAPSHOTS=1 npx vitest run tests/level-content.test.ts` 重新生成。
- `npm run dev` 试玩；通关、判题、波形、提示对任意模式的关卡完全同构。

## TS 入口（程序化场景）

需要在代码里组装 spec（例如测试构造或批量生成）时，可用类型化包装走同一个编译器：

```ts
import { defineLevel } from './levelSpec';
const myLevel = defineLevel({ /* 与 JSON 同构的 LevelSpec 对象 */ });
```

关卡目录本身只认 `content/levels/*.json`；`defineLevel` 的产物不会进入聚合数组。
