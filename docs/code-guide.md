# 逻辑工坊 · 代码导读

本文面向需要阅读或修改本项目代码的开发者，梳理代码结构、模块职责与关键数据流。游戏玩法与通关说明见 [README](../README.md)，各阶段的设计与验收记录见 `docs/` 下其余文档。

## 1. 项目概览

「逻辑工坊」是一个数字逻辑教学游戏：共 57 关，全部关卡由 `content/levels/*.json` 声明式描述（见 [关卡编写指南](level-authoring.md)）。玩家从连线开始，逐步搭出逻辑门、加减法器、寄存器、存储器，最终组成一台能真实执行指令的八位 CPU，并在其上用汇编完成算法任务（第 45–56 关 CPU 电路固定，玩家只写程序）。

技术栈：

| 依赖 | 用途 |
|---|---|
| React 19 + TypeScript 5.9 + Vite 7 | 应用框架与构建 |
| @xyflow/react (React Flow) | 电路编辑画布（节点/端口/连线） |
| digitaljs 0.14.2 (`HeadlessCircuit`) | 交互路径的门级仿真引擎 |
| 3vl (`Vector3vl`) | 三值逻辑（0/1/X）位向量 |
| elkjs | 组件内部电路预览的自动布局 |
| lucide-react | 图标 |
| Vitest / Playwright | 单元测试 / 浏览器验收测试 |

## 2. 目录结构

```
src/
├─ contracts.ts              # 全局数据契约：节点、导线、电路、组件、仿真与判题结果类型
├─ model.ts                  # 电路构造与全部合法性校验规则
├─ netlist.ts                # 层级组件展开为扁平网表、组合环检测
├─ id.ts / vendor.d.ts / gates.ts # 随机 ID 生成 / digitaljs 类型声明 / 门型清单
│
├─ levels.ts                 # 关卡接口与聚合入口（含启动期关卡号守卫）
├─ levelSpec.ts              # 关卡编写 API：LevelSpec 校验与编译（含编程用例注册表）
├─ levelExpr.ts              # 期望值表达式迷你语言（纯整数安全求值器）
├─ levelRegistry.ts          # 声明式关卡的统一编译（数据来自 levelData.generated，npm run regen:levels 再生成）
├─ levelGenerators.ts        # 命名场景/用例生成器：JSON 引用，编译期展开穷举判题数据（temporal/architecture 等）
├─ architectureSpec.ts       # 指令集规格（编码/译码）、参考 ALU/控制器/整机状态机
├─ architectureCircuits.ts   # 教学组件库（MUX/寄存器/ALU/PC/.../整机）与参考电路
├─ programmingSpec.ts        # 第 45–56 关的数学测试用例与参考汇编程序
├─ programmingMachine.ts     # 编程关卡的固定 CPU 电路、依赖闭包与防篡改校验
│
├─ simulator.ts              # 交互仿真（DigitalJS）与判题入口 judge()
├─ combinationalEvaluator.ts # 判题内核：把门级图编译成位槽数组指令序列
├─ sequentialEvaluator.ts    # 判题内核的时序封装（沿上采样/提交两阶段）
├─ programmingRunner.ts      # 编程关卡的运行/单步/断点/判题
├─ assembler.ts              # 汇编器与反汇编器
├─ programEditor.ts          # ROM 十六进制字文本的解析/格式化
│
├─ simulation.worker.ts      # Web Worker：交互仿真会话、判题、存档解析、证明重验
├─ workerClient.ts           # 主线程侧：一次性后台任务 + useSimulation Hook
├─ storage.ts                # 版本化存档（读 v1–v7 写 v7：稀疏草稿、规范库代码重建、导入重验）
│
├─ components.ts             # 玩家组件：整图保存 / 框选封装 / 实例展开
├─ componentManagement.ts    # 组件库管理：重命名、软删除、依赖闭包、替换实例
├─ libraryGrouping.ts        # 组件库展示分组：相似元件按家族合并、位宽变体切换
├─ WorkshopView.tsx          # 元件工坊：独立于关卡的自定义组件搭建台（levelId=0 草稿）
│
├─ App.tsx                   # 工作区主界面：游戏状态、编辑器、测试面板、各类弹窗
├─ CircuitNode.tsx           # React Flow 节点渲染（端口、信号、门符号）
├─ WireEdge.tsx              # 导线渲染（按信号着色）
├─ ComponentPreview.tsx      # 组件内部电路的只读预览（ELK 自动布局）
├─ TimingWaveform.tsx        # 时序波形图
├─ ArchitecturePanel.tsx     # 机器观察面板 + ROM 十六进制编辑器
├─ ProgrammingPanel.tsx      # 汇编工作台（源码编辑、断点、RAM、用例表）
├─ main.tsx / styles.css     # 入口与样式

tests/                       # Vitest 单元测试 (*.test.ts) 与 Playwright 浏览器测试 (*.spec.ts)
content/levels/              # 声明式关卡（全部 57 关，JSON，见 docs/level-authoring.md）
docs/                        # 各阶段设计/验收文档与示例存档
scripts/start-server.mjs     # 本地后台开发服务
```

## 3. 分层架构

```
┌────────────────────────── UI 层 ──────────────────────────┐
│ App.tsx（游戏状态与工作区）                                  │
│  ├ CircuitNode / WireEdge（画布）                           │
│  ├ TimingWaveform / ArchitecturePanel / ProgrammingPanel    │
│  └ ComponentPreview（只读预览）                              │
└──────────────┬─────────────────────────────────────────────┘
               │ useSimulation / backgroundTask（workerClient.ts）
┌──────────────▼────────────────── Worker 层 ────────────────┐
│ simulation.worker.ts                                        │
│  交互会话 ──► simulator.ts ──► DigitalJS HeadlessCircuit     │
│  判题     ──► judge() 分发：                                 │
│     组合 ──► combinationalEvaluator.compileCombinational     │
│     时序 ──► sequentialEvaluator.compileSequential           │
│     编程 ──► programmingRunner.judgeProgramming              │
│  存档     ──► storage.parseWorkspace（证明重验也走 judge）     │
└──────────────┬──────────────────────────────────────────────┘
               │ 共同依赖
┌──────────────▼────────────────── 领域层 ────────────────────┐
│ model.ts（构造/校验） ── netlist.ts（层级展开）                │
│ levels*.ts / architecture*.ts / programming*.ts（关卡内容）    │
│ components.ts / componentManagement.ts（组件系统）            │
│ storage.ts（存档）                                           │
└─────────────────────────────────────────────────────────────┘
```

两条不可违背的设计原则贯穿全库：

1. **期望值独立**：每关的期望输出由独立数学定义产生（组合关是 `levelExpr.ts` 求值的整数表达式、时序关是 `levelGenerators.ts` 参考状态机展开的帧、编程关是 `programmingSpec.ts` 的数学用例；`architectureSpec.ts` 的 ALU/译码/控制器函数仍是教学组件电路与测试的数学权威），不经过任何电路或仿真器。判题永远是「玩家电路的实际行为 vs 数学期望」。
2. **判题即真实门级仿真**：没有任何指令解释器。编程关卡也编译玩家保存的 ROM 到真实门级图上逐周期执行（`programmingRunner.ts`），观察到的 PC/IR/Phase 全部来自电路信号。

## 4. 核心数据模型（contracts.ts）

- **信号 `Signal`**：`number`（各 bit 已知）、`'X'`（全部未知）或二进制字符串（部分未知，如 `'1X0'`）。三值语义与 3vl 库一致。
- **节点 `CircuitNode` / 导线 `Wire` / 图 `CircuitGraph`**：`graph = { nodes, wires }`。导线按 `节点:端口` 连接；一个输入端口最多一条导线（多驱动被拒绝）。
- **`Circuit extends CircuitGraph`**：加上 `levelId` 与 `revision`。revision 每次编辑自增，UI 用它判断测试结果是否仍对应当前电路（`result.revision === circuit.revision`）。
- **组件 `ComponentDefinition` / `ComponentLibrary`**：库键格式为 `` `${id}@${version}` ``。同名保存产生新版本，旧实例继续引用旧键，因此历史草稿与通关证明永不失效。`graph` 是组件内部电路，`dependencies` 必须与图内 `COMPONENT` 节点引用一致。
- **运行状态 `RuntimeState`**：`{ cycle, registers, memories? }`，按扁平化后的实例路径（如 `c1/c2/g3`）隔离存储元件状态。
- **判题结果 `TestResult`**：一组 `TestRow`（期望/实际/失配端口列表），顺序通关取第一个失败行做反例回放。

各节点的端口形状由 `model.ts` 的 `getPorts()` 唯一决定：

| 类型 | 输入 | 输出 |
|---|---|---|
| INPUT / CONST | — | `out` |
| OUTPUT | `in` | — |
| NOT | `a` | `out` |
| 其他基本门 | `a`,`b` | `out` |
| DFF | `d`, `rst`(1bit) | `q` |
| ROM | `addr`(8) | `q`(16) |
| RAM | `addr`(8),`d`(8),`we`(1),`rst`(1) | `q`(8) |
| SPLIT / JOIN | `in` ↔ `in0..inN` | `out0..outN` ↔ `out` |
| COMPONENT | 组件定义的 `inputs` | 组件定义的 `outputs` |

位宽只允许 1/2/4/8/16；ROM 固定 16 位字、RAM 固定 8 位。

## 5. 校验规则（model.ts）

所有修改电路的入口（`addGate` / `addComponent` / `connect` / 封装 / 展开 / 复制）都遵循同一模式：先构造 `next`，再 `validateCircuit(next, library)[0]`，有错即抛出（UI 转成 toast）。校验层次：

- `validateGraph`：单图合法性——ID 唯一、类型/位宽/常量范围/ROM 字有效、导线方向输出→输入、位宽一致、输入端口不重复驱动、规模上限（200 节点 / 400 导线）。
- `validateLibrary`：每个组件版本——键与 `id@version` 一致、接口端口与内部 INPUT/OUTPUT 节点一一对应、依赖清单与实际引用一致、递归依赖与展开规模检测（≤2000 节点 / 5000 导线 / 深度 16）、可用组件不得依赖已删除组件、组合环检测。
- `validateCircuit`：当前关卡电路——关卡存在、固定端口未被增删改、只使用本关解锁的门类型、额外 INPUT/OUTPUT 拒绝、展开规模、组合环；编程关卡额外调用 `validateProgrammingMachine` 检查 CPU 与依赖组件未被篡改。

`netlist.ts` 提供两个支撑函数：`flattenGraph` 把嵌套组件递归展开成带实例路径的扁平图（组件边界节点保留为 Repeater，保证真实依赖关系不丢）；`hasCombinationalCycle` 在扁平图上做拓扑排序，**忽略 DFF 的 d/rst 输入与 RAM 的写端口**（经存储元件的反馈是合法时序逻辑），其余边成环即拒绝。

## 6. 双仿真引擎

### 6.1 交互引擎（simulator.ts，DigitalJS）

`compile()` 把扁平图翻译为 DigitalJS 的 `HeadlessCircuit`：

- 普通门直接映射为 DigitalJS 器件（NAND→Nand、SPLIT→BusUngroup 等；根级 INPUT/OUTPUT→Input/Output，组件边界→Repeater）。
- **DFF/ROM/RAM 不交给引擎**，而是被「外置」：`q` 变成一个 Input 器件（由我们 `setInput` 注入状态），`d/rst/addr/we` 变成 Output 器件（用 `getOutput` 采样）。引擎只负责组合逻辑求值，存储元件的沿上采样由 `advance()` 自己做——先 `apply` 旧状态求值、读出所有 d/rst，再一次性提交新状态、重新求值。这实现了「全部存储元件先采样旧值再同时更新」。
- ROM/RAM 读取按地址可能含 X 位（`addresses()` 枚举候选地址，`merge()` 按位合并为保守结果）；`settleMemories()` 迭代到「存储器输出经门级反馈再作地址」也稳定为止。

对外接口：`simulate()`（单步，可带 tick）、`replaySequence()`（回放场景并保留最近 64 帧 trace）、`createSimulationSession()`（供编程关卡复用编译结果）、`judge()`（判题入口，见下）。

### 6.2 判题内核（combinationalEvaluator.ts / sequentialEvaluator.ts）

为绕开 DigitalJS 事件循环的开销，批量判题使用自研内核：

- `compileGateKernel()` 把扁平图编译成**拓扑排序的指令数组**，操作在两个 `Uint32Array` 位槽（`known` / `value` 掩码对）上，每个输出端口占一个槽。所有门运算都写成掩码代数（例如 AND：`ones = a&ak&b&bk`，`zeros = (~a&ak)|(~b&bk)`，已知位 = 两者并集），天然支持三值信号。SLOT 0 表示「无驱动全未知」。
- DFF/RAM 同样被外置为 `storage` 描述符；写入端口（d/rst/we）不参与拓扑边，因此经过它们的环不影响排序。
- `compileSequential()` 在内核外维护 `registers`/`memories`/`cycle`，`step(inputs, tick)` 的两阶段与交互引擎完全同构：求值旧状态 → 采样 → 提交 → 再求值。两者由等价单元测试保证一致。
- `compileCombinational()` 是快速路径：图内无任何存储元件时返回 `(inputs) => outputs` 的纯函数。

### 6.3 判题分发（simulator.ts `judge()`）

| 关卡模式 | 期望来源 | 实际来源 |
|---|---|---|
| 组合（1–20、33–34、37、40…） | `level.expectedOutputs`（数学函数） | `compileCombinational` × `testInputs`（穷举或公开用例集） |
| 时序（21–32、35–36、38–39、41–44） | 场景生成器调用独立数学状态机 | 每场景重置后 `compileSequential.step()` 逐步比对；场景可携带测试 ROM |
| 编程（45–56） | `programmingSpec.programmingCases`（数学结果） | `judgeProgramming`：载入用例 RAM，检查 OUT 序列、正常停机与必要内存 |

`testInputs()` 默认穷举全部输入组合（按端口位宽从高位到低位编码）；关卡提供 `cases()` 时使用公开测试集；时序/编程模式返回空（走 `sequences`/`cases` 路径）。

### 6.4 编程运行器（programmingRunner.ts）

`createProgrammingRunner()` 包装一个 `compileSequential` 内核：

- `restart(caseId)` 把用例的 `memory` 写入 RAM 状态；`step()` 推进一个周期，同时以观察者身份识别 OUT（IR===0x8000 且 Phase===2）记录输出事件——**指令效果本身仍全部来自门级图**。
- `run()` 每批最多 90 周期，支持地址断点（取指前命中；继续时跳过当前地址一次）；`instruction()` 单步至多推进 3 个周期（一条普通指令 = 取指/译码/执行三个有效周期）。
- `judgeProgramming()` 逐用例运行到 Halt/FAULT/预算耗尽，逐次比对 OUT 事件序列，最后校验 `expectedMemory`。

## 7. Web Worker 协议（simulation.worker.ts / workerClient.ts）

Worker 承担全部重活，主线程只做 UI：

- `workerClient.useSimulation(circuit, inputs, library, epoch)`：持有**常驻** Worker，输入或图变化时发送 `simulate`；`tick/reset/replay/programStep/programRun/programCase` 为交互命令。回包按自增 `id` 过滤过期结果（旧请求的回复直接丢弃）。`epoch`（即 App 的 `fitEpoch`）参与会话键，用于强制重置试验状态。
- `workerClient.backgroundTask(operation, payload, signal)`：**一次性** Worker，用于 `judge`（判题）、`verify`（证明重验）、`load`（存档解析），支持 AbortSignal 取消。
- Worker 内部的交互会话按 `sessionKey`（电路去位置后的 JSON + 组件库）缓存运行状态：移动节点不清零试验，改结构/换关/切程序即重置；`replay` 用 `replaySequence` 重建到失败步。编程关卡单独走 `programRunner` + `programSnapshot`（DigitalJS 会话，供机器面板显示）。

## 8. 关卡内容组织

- `levels.ts` 定义 `Level` 接口（接口端口、允许门型、三层提示、期望函数、模式）并聚合 `specLevels()`（按 id 排序）；`chapters` 为章节标题，模块加载时守卫关卡号唯一。
- **全部 57 关都是声明式关卡**：`content/levels/*.json` 是纯数据（文案、端口、提示、期望值表达式/真值表/手写帧/生成器引用/编程用例），由 `levelRegistry.ts` 构建期装载、`levelSpec.ts` 运行时校验并编译成 `Level`（生成器引用在编译期由 `levelGenerators.ts` 展开）。期望值依然独立于任何电路或仿真器；`tests/level-content.test.ts` 的快照固化第 1–20 关全部穷举期望与全关卡判题数据摘要（sha1），防止悄悄改判题标准。作者指南见 [关卡编写指南](level-authoring.md)。
- 第 21–44 关的时序场景帧（`TestSequence`：逐步 `{inputs, tick, expectedOutputs}`，覆盖保持、复位优先级、同沿读写旧值、回绕等细节）与第 33/34/40 关的公开用例集都以 `"generator": "名字"` 引用 `levelGenerators.ts`，编译期展开并复用手写数据的同一校验——JSON 保持人可编写的小体积，穷举数据由独立参考状态机（`temporalOracle` / `architectureOracle`）产生；第 45–56 关的编程用例与参考源是 JSON 里的紧凑数据。`defineLevel()`（同一编译器的 TS 包装）供程序化组装 spec 使用，不进入目录聚合。
- `architectureSpec.ts` 是 ISA 唯一权威：16 位指令 = Opcode[15:12] · Param[11:8] · Imm[7:0]，10 条指令；`architectureOracle` 是完整参考 CPU（三阶段状态机）；`architecturePrograms` 是第 44 关判题用的 10 个测试程序。
- `architectureCircuits.ts` 用 `Builder` DSL（`gate/and/or/split/join/mux/reg/dff/component...`）生成 23 个可查看的教学组件（mux1–16、register1–16、adder8、alu、registers、pc、decode、phase、controller、datapath、fetch、memory、computer）与第 33–44 关参考电路。注意 `architectureLibrary()` 每次返回全新深拷贝，调用方可安全保存/修改自己的副本。
- **机器注册表（machines.ts）**：`MachineDescriptor { key, name, sourceLevel, instructions, circuit(levelId), library() }` 描述「之前关卡中构建的计算机」，`machines` 数组即扩展点（当前仅 `computer-44`，10 条指令）。编程关草稿由 `machineForLevel(id).circuit(id)` 生成（清空 ROM 的整机）；`machineKeyOf(circuit)` 按规范化图（`stable()` 排序键、忽略位置与 ROM 字）识别草稿当前持有哪台机器，`validateProgrammingMachine` 与注册表中任一机器逐字节等价即合法——判题本就对草稿电路跑门级仿真，天然按所选机器判定。汇编器 `assemble`/`disassemble` 接受可选机器参数，源码只能使用该机 `instructions` 子集（报「{机名}不支持指令 X」）；编程面板顶部的机器选择器（选项按通关 `sourceLevel` 解锁，单台时禁用）切换时保留能重新汇编的 `programSource`，汇编不过则清空 ROM 待重新应用。`programmingMachine.ts` 保留为纯转发垫片；关卡 JSON 的 `program.machine`（可选，默认注册表第一台）为未来关卡绑定新机预留。

## 9. 组件系统（components.ts / componentManagement.ts）

- `packageCircuit`：整关通关电路保存为组件，接口即关卡 INPUT/OUTPUT。
- `encapsulateSelection`：框选子图封装。跨越选区边界的导线被收集为接口端口（标签 `源.端口`），内部连线保留，选区在原图中被一个 COMPONENT 实例替换，外接连线原样转接。
- `expandComponent`：反向内联展开，临时接口节点按「每个进入 × 每个离开」笛卡尔拼接后删除，因此「组件输出直接反馈回自己输入」的连线也能正确落回真实驱动者。
- 同名保存（`define`）自动 `version+1`；旧版本永远留在库里保护历史引用。
- 管理侧：`dependentComponentKeys` 求传递依赖闭包（删除时一并软删除）；`markComponentsDeleted` 软删除后，电路中的残留实例标红、只能移除或替换（`replaceComponentInstance`，要求接口端口完全一致）；`pruneDeletedComponents` 在序列化时清掉不再被任何活组件/关卡电路/证明引用的已删除版本；`renameComponent` 同步更新库内所有引用处的实例标签。
- **元件工坊（WorkshopView.tsx）**：独立于关卡的全屏搭建台。电路是 `levelId=0` 的工坊草稿（`createWorkshopCircuit`/`validateWorkshopCircuit` 不绑定关卡端口），INPUT/OUTPUT 自由添加且即未来组件接口；`model/components` 的增删连线封装操作都带 `workshop` 尾参切换到该校验。交互仿真复用 `useSimulation`（`simulator.checkedSession` 同样按 levelId 分派校验器），草稿持久化在 `Workspace.workshop`（开关值不持久化）；侧栏组件库可"新建元件"或对玩家组件"在工坊中编辑"（载入 `def.graph`，同名保存经 `define` 自动 vN+1）。
- **组件库家族分组（libraryGrouping.ts）**：`groupComponentFamilies` 按「去掉位宽前缀的基础名（`stripWidthMarker`，识别 八位/4位/8-bit 等写法）+ 输入/输出端口数」把相似元件合为一家（端口数而非端口 id 作签名——工坊封装的组件端口 id 是随机节点 id）；家族内按端口推导位宽（`componentWidth`，全部端口位宽最大值）分桶，多个位宽变体时 UI 用小选择框切换（`activeVariant` 未选时默认最宽），桶内版本号降序、最新置顶。组件库标签页、教学组件面板与工坊调色板三处共用。

## 10. 存档（storage.ts，v7）

- `Workspace`（version 7）：`{ currentLevel, circuits, proofs, inputs, library, workshop? }`，localStorage 键 `logic-workshop.v1`（不变，浏览器里的旧档下次启动自动升级）。证明（proofs）独立于草稿——修改草稿不影响通关进度，但旧证明只对当初的电路负责；`workshop` 是元件工坊草稿（levelId=0 哨兵，`parseWorkshopCircuit` 走自由接口校验）。
- **稀疏存储**：文件只落玩家动过的关卡草稿/证明；缺失草稿载入时按目录合成（普通关 `createCircuit`、编程关按绑定机器），与种子完全一致的草稿（revision 与规范化图都相等）序列化时剪枝，round-trip 保持深度相等。目录外、非数字、或超该版本历史关卡上限（v1–v4 分别只到 4/20/32/44 关）的键一概忽略，不再让整档失效。
- **规范组件不落档**：`library` 只存玩家组件（`component-*`）；规范机库 `canonicalMachineLibrary()`（全部教学组件 ∪ 每台注册机器的依赖闭包）由代码在解析时现建并以 `{...canonical, ...playerOnly}` 覆盖合并——代码版永远赢，篡改面归零，ISA/架构演进不再破坏旧档。代码已不认识的旧规范键（如更名前的 `architecture-mux1@2`）按玩家组件同等保留，否则引用它的历史草稿会失效；序列化与解析对称（规范键不写、未知键照写）。
- `parseWorkspace` 接受 v1–v7（`>7` 专属报错「来自更新版本」）：`parseGraph`/`parseCircuit`/`parseLibrary` 逐字段严格校验（含 `programSource` 必须能在草稿当前识别的机器下汇编、原型链键名防护）；最后（默认）在 Worker 里逐关重跑 `judge` 重验证明，断链即截断、只降级进度不拒档，全部通过才一次性替换工作区。
- `serializeWorkspace` 输出确定性 JSON（先 `pruneDeletedComponents`），支持缩进参数供导出可读文件；4 MB 上限为护栏（超限拒绝导入）。
- 主线程写入策略（App.tsx）：状态变化后 400ms 防抖保存；`pagehide` 时强制落盘；失败时状态条持续提示并建议导出备份。

## 11. UI 层要点（App.tsx 及组件）

`App.tsx` 的 `Workshop` 是唯一有状态的顶层组件，大致分四块：

1. **工作区状态**：`workspace`（存档镜像）、`history`（每关独立的撤销栈，上限 80 步）、`result`（最近判题结果）、`selection`、`hints`、各类弹窗开关。`commit(next)` 是所有电路修改的统一入口：取消后台任务、压栈撤销历史、写入工作区。
2. **交互仿真**：`useSimulation` 挂钩；播放（组合关轮播输入、时序关推进时钟、编程关 `programRun`）用 `setInterval` 驱动。
3. **判题**：`runTest()` 走 `backgroundTask('judge')`，通过则把当前电路写入 `proofs` 并解锁下一关；失败则定位反例行并自动回放（时序/编程关卡调用 Worker 的 `replay` 重建失败前状态）。
4. **画布**：React Flow 受控模式。`flowNodes`/`flowEdges` 每次渲染重建，信号值、待连线端口、失败高亮都通过 `data` 下传；`isValidConnection` 实时调用 `canConnect` 提供拖线预检；节点拖动结束才 `commit`（拖动前快照进撤销栈）；支持框选、拖放添加、空格/中键平移、Delete/Ctrl+Z/Ctrl+D 快捷键。

其余 UI 文件：`CircuitNode.tsx` 渲染节点/端口/门符号并处理端口点击连线；`WireEdge.tsx` 按信号值着色（绿=1、灰=0、橙=X、红=失败反例相关）；`ComponentPreview.tsx` 用 ELK 分层布局渲染组件内部（加载失败回退原坐标）；`TimingWaveform.tsx` 把 ≤64 帧观察画成波形（1bit 画跳变线、总线画数值格）；`ArchitecturePanel.tsx` 展示真实 PC/IR/Phase/寄存器并提供 ROM 十六进制编辑；`ProgrammingPanel.tsx` 是汇编工作台（实时汇编、断点、RAM 分页、输出事件、用例表与回放）。

## 12. 规模与限制常量一览

| 限制 | 值 | 出处 |
|---|---|---|
| 可见电路 | 200 节点 / 400 导线 | `model.ts validateGraph` |
| 嵌套展开 | 2000 节点 / 5000 导线 / 深 16 层 | `model.ts validateLibrary` |
| 组件库 | 256 个版本，总节点 20000 | `model.ts` / `storage.ts` |
| 组件接口 | ≤32 个端口 | `model.ts` |
| ROM | 256 字 × 16bit；汇编源 ≤32000 字符 | `contracts`/`storage.ts`/`assembler.ts` |
| 存档 | ≤4 MB | `storage.ts` |
| 波形/回放 trace | 最近 64 帧 | `simulator.ts`/`simulation.worker.ts` |
| 快速运行批次 | ≤90 周期/批 | `programmingRunner.ts` |
| 撤销历史 | 每关 80 步 | `App.tsx` |
| 仿真稳定上限 | 100000 事件 / 存储器寻址轮数 = 存储器数+1 | `simulator.ts` |

## 13. 测试体系

```bash
npm test          # Vitest 单元测试（约 300 项）
npm run build     # tsc -b && vite build（类型检查 + 生产构建）
npm run test:e2e  # Playwright 浏览器验收（约 36 项，需要 Chromium）
```

- 单元测试覆盖：判题内核与 DigitalJS 的等价性（`architecture-*`、`circuit.test.ts`）、关卡期望与场景完整性（`levels/time-levels/...`）、汇编器、存档迁移与防篡改、组件管理、Worker 时序。
- `tests/fixtures.ts`、`sequential-fixtures.ts`、`architecture-fixtures.ts` 提供参考电路。
- 浏览器测试在真实页面上走「连线 → 测试 → 解锁 → 存档导入导出 → 编程应用」全流程，包括判题期间持续编辑等竞态场景。

## 14. 常见开发任务指引

- **新增一关**：在 `content/levels/` 写一份 JSON（格式与示例见 [关卡编写指南](level-authoring.md)），`npm run regen:levels` 再生成后 `npm test` 会校验结构、关卡号、期望值与判题数据摘要快照。组合/时序/编程三种模式都由数据描述，无需改代码；注意 `chapters` 划分与存档的关卡目录兼容策略。
- **修改指令集**：`architectureSpec.ts` 是唯一权威（`instructionSet`、`encode/decodeInstruction`、`architectureOracle`）；同时检查 `assembler.ts` 的助记符表、`ArchitecturePanel` 的展示、`architectureCircuits.ts` 的译码器/控制器门电路与参考程序。
- **新增门类型**：`contracts.ts` 的 `GateType` → `model.ts getPorts/validateGraph` → `combinationalEvaluator` 指令集与掩码运算 → `simulator.ts compile()` 的 DigitalJS 映射 → `CircuitNode.tsx` 符号 → 各关卡 `allowed`。
- **新增存储元件**：参照 DFF/RAM 的三处外置处理（`simulator.ts` 的编译与提交、`combinationalEvaluator` 的 storage、`netlist.hasCombinationalCycle` 的写端口豁免），并为两引擎补等价测试。
- **调整判题规模**：同步修改 `model.ts` 的上限、`storage.ts parseGraph` 的上限与相关测试，README 的说明也需更新。
