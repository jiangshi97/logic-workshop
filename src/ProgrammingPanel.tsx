// 汇编工作台（第 45–56 关）：源码编辑与实时汇编、指令断点、E/R 直接操作、RAM 分页观察、
// 输出事件记录与公开用例表；dirty 状态下禁止运行，需先「应用汇编」把 words 与源码一起写入 ROM 节点。
import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Code2, ChevronLeft, ChevronRight, Play, Pause, StepForward, RotateCcw } from 'lucide-react';
import type { CircuitNode, Inputs, Simulation, TestResult, TestRow } from './contracts';
import { assemble, disassemble } from './assembler';
import { programmingCases } from './programmingSpec';
import { instructionLabel } from './ArchitecturePanel';

/** 取 ROM 节点的汇编源：优先已保存的 programSource，否则尝试反汇编 words。 */
function sourceOf(node: CircuitNode): string {
  if (node.programSource !== undefined) return node.programSource;
  try { return disassemble(node.words ?? []); }
  catch { return '; 当前ROM包含非法指令，请编写新的合法程序。'; }
}
const stopNames: Record<string, string> = { halt: '程序已停止', fault: '非法指令，程序已停止', breakpoint: '断点已命中', budget: '超过周期预算，运行已暂停', paused: 'E=0，机器保持' };

export function ProgrammingPanel({ levelId, node, simulation, result, busy, playing, inputs, onInputs, breakpoints, onBreakpoints, onApply, onDirty, onEditing, onStep, onCycle, onRun, onRestart, onCase, onReplay, machineVisible, onMachineView }: {
  levelId: number; node: CircuitNode; simulation: Simulation & { pending: boolean }; result: TestResult | null;
  busy: boolean; playing: boolean; breakpoints: number[]; onBreakpoints: (values: number[]) => void;
  inputs: Inputs; onInputs: (values: Inputs) => void;
  onApply: (words: number[], source: string) => void; onDirty: (dirty: boolean) => void; onEditing: () => void;
  onStep: () => void; onCycle: () => void; onRun: () => void; onRestart: () => void;
  onCase: (caseId: string) => void; onReplay: (row: TestRow) => void;
  machineVisible: boolean; onMachineView: () => void;
}) {
  const savedSource = sourceOf(node);
  const [source, setSource] = useState(savedSource);
  const [memoryPage, setMemoryPage] = useState(15);
  const [casesPage, setCasesPage] = useState(0);
  const cases = useMemo(() => programmingCases(levelId), [levelId]);
  const dirty = source !== savedSource;
  useEffect(() => { setSource(savedSource); }, [savedSource, levelId]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const compilation = useMemo(() => {
    try { return { result: assemble(source), error: '' }; }
    catch (error) { return { result: undefined, error: (error as Error).message }; }
  }, [source]);
  const currentCase = cases.find(item => item.id === simulation.program?.caseId) ?? cases[0];
  const listing = compilation.result?.listing ?? [];
  const pc = simulation.values.PC;
  const selectedLine = !dirty ? listing.find(item => item.address === pc)?.line : undefined;
  const stopped = simulation.program?.stopReason;
  const disabled = busy || simulation.pending;
  const casePages = Math.max(1, Math.ceil(cases.length / 8));
  const shownPage = Math.min(casesPage, casePages - 1);
  const visibleCases = cases.slice(shownPage * 8, shownPage * 8 + 8);
  const apply = () => { if (compilation.result) onApply(compilation.result.words, source); };
  const breakpoint = (address: number) => onBreakpoints(breakpoints.includes(address) ? breakpoints.filter(item => item !== address) : [...breakpoints, address].sort((a, b) => a - b));

  return <section className="programming-workbench" aria-label="编程工作台">
    <header className="programming-heading"><div><Code2 size={18} /><strong>汇编工作台</strong><span>8位CPU · 16位指令</span></div><button className="secondary-button" onClick={onMachineView}>{machineVisible ? '返回程序编辑' : '查看 CPU 电路'}</button></header>
    <div className="programming-debug-toolbar">
      <label>输入用例<select aria-label="程序输入用例" value={currentCase.id} disabled={disabled || playing} onChange={event => { onCase(event.target.value); setCasesPage(Math.floor(cases.findIndex(item => item.id === event.target.value) / 8)); }}>{cases.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button className="secondary-button" aria-label="重启用例" disabled={disabled} onClick={onRestart}><RotateCcw size={14} />重启</button>
      <button className="secondary-button" aria-label="程序使能 E" aria-pressed={inputs.E === 1} disabled={disabled} onClick={() => onInputs({ ...inputs, E: inputs.E ? 0 : 1 })}>E={inputs.E}</button>
      <button className="secondary-button" aria-label="程序复位 R" aria-pressed={inputs.R === 1} disabled={disabled} onClick={() => onInputs({ ...inputs, R: inputs.R ? 0 : 1 })}>R={inputs.R}</button>
      <button className="secondary-button" aria-label="单步指令" disabled={disabled || dirty || playing} onClick={onStep}><StepForward size={14} />指令单步</button>
      <button className="secondary-button" aria-label="编程单步周期" disabled={disabled || dirty || playing} onClick={onCycle}>周期单步</button>
      <button className="secondary-button" aria-label={playing ? '暂停快速运行' : '快速运行程序'} disabled={busy || dirty || (!playing && simulation.pending)} onClick={onRun}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '运行'}</button>
      <span className={`programming-run-status ${stopped ? 'stopped' : ''}`} role="status" data-testid="program-run-status">{stopped ? stopNames[stopped] : playing ? '运行中' : '就绪'}{selectedLine ? ` · 源第${selectedLine}行` : ''}</span>
    </div>
    <p className="programming-input-summary" data-testid="program-input-summary">{Object.keys(currentCase.memory).length ? Object.entries(currentCase.memory).map(([address, value]) => `RAM[${address}]=${value}`).join(' · ') : '本关不需要输入数据'} · 预算 {currentCase.maxCycles} 周期 · 重启用例会重新载入输入</p>
    {!machineVisible && <div className="assembly-columns">
      <section className="assembly-source"><div className="assembly-section-heading"><label htmlFor="assembly-source">汇编源代码</label><span>{dirty ? '有修改，应用后运行' : '已应用'} · {compilation.result?.words.length ?? '—'} / 256 字</span></div>
        <textarea id="assembly-source" aria-label="汇编源代码" maxLength={32000} spellCheck={false} value={source} onChange={event => { onEditing(); setSource(event.target.value); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply(); } }} placeholder={'MOVI A, 42\nOUT\nHLT'} />
        <div className="assembly-apply"><p className={compilation.error ? 'assembly-error' : 'assembly-valid'} role={compilation.error ? 'alert' : undefined}>{compilation.error || `${listing.length} 条指令 · 应用会重启当前用例`}</p><button className="test-button" aria-label="应用汇编" disabled={busy || !!compilation.error} onClick={apply}><Check size={14} />应用汇编</button></div>
      </section>
      <section className="assembly-listing"><div className="assembly-section-heading"><strong>{dirty ? '汇编预览' : '已应用指令'}</strong><span>点击圆点设断点</span></div><div className="assembly-listing-scroll"><table><thead><tr><th>断点</th><th>地址</th><th>指令字</th><th>源行 / 指令</th></tr></thead><tbody>{listing.map(item => <tr key={item.address} className={!dirty && item.address === pc ? 'current-instruction' : ''} aria-current={!dirty && item.address === pc ? 'step' : undefined}>
        <td><button className={`breakpoint-button ${breakpoints.includes(item.address) ? 'set' : ''}`} aria-label={`断点 地址 ${item.address}`} aria-pressed={breakpoints.includes(item.address)} disabled={dirty || busy} onClick={() => breakpoint(item.address)}><span /></button></td><td>{item.address.toString(16).toUpperCase().padStart(2, '0')}</td><td>{item.word.toString(16).toUpperCase().padStart(4, '0')}</td><td><span className="source-line-number">{item.line}</span>{instructionLabel(item.word)}</td>
      </tr>)}</tbody></table>{!listing.length && <p className="empty-program">写下程序，汇编结果会显示在这里。</p>}</div></section>
    </div>}
    <div className="programming-observation"><section className="program-output"><div className="assembly-section-heading"><strong>输出事件</strong><span>{simulation.program?.outputs.length ?? 0} 次 OUT</span></div><p data-testid="program-output-events">{simulation.program?.outputs.length ? simulation.program.outputs.join(' → ') : '尚无输出'}</p><small>每条OUT记录一次，即使连续输出相同数字。当前已执行 {simulation.program?.instructions ?? 0} 条指令。</small></section>
      <section className="program-memory" aria-label="RAM观察"><div className="assembly-section-heading"><strong>RAM · 十进制</strong><div className="pagination"><button className="tool-button" aria-label="上一页内存" disabled={!memoryPage} onClick={() => setMemoryPage(page => page - 1)}><ChevronLeft size={14} /></button><span>{memoryPage * 16}–{memoryPage * 16 + 15}</span><button className="tool-button" aria-label="下一页内存" disabled={memoryPage === 15} onClick={() => setMemoryPage(page => page + 1)}><ChevronRight size={14} /></button></div></div><dl className="memory-cells">{Array.from({ length: 16 }, (_, index) => memoryPage * 16 + index).map(address => <div key={address} className={Object.hasOwn(currentCase.memory, address) ? 'input-memory' : ''}><dt>{address}</dt><dd data-testid={`ram-${address}`}>{simulation.program?.memory[address] ?? '—'}</dd></div>)}</dl></section>
    </div>
    <section className="program-cases" aria-label="程序测试用例"><div className="assembly-section-heading"><strong>公开程序测试</strong><span>{cases.length} 个用例 · 检查输出顺序、停止与必要内存</span></div><div className="program-cases-scroll"><table><thead><tr><th>用例 / 输入</th><th>期望输出</th><th>实际 / 结果</th><th>观察</th></tr></thead><tbody>{visibleCases.map(item => {
      const row = result?.rows.find(candidate => candidate.scenarioId === item.id);
      return <tr key={item.id} className={row && !row.passed ? 'failed-row' : ''}><td>{item.label}</td><td>{item.expectedOutput.join(' → ')}</td><td>{row ? <><span className={`table-status ${row.passed ? 'pass' : 'fail'}`}>{row.passed ? '通过' : row.program?.reason || '失败'}</span><small>{row.program?.actualOutput.join(' → ') || '尚无输出'} · {row.cycle} 周期</small></> : '待测试'}</td><td><button className="case-observe" aria-label={`观察程序用例 ${item.id}`} disabled={disabled || playing} onClick={() => row ? onReplay(row) : onCase(item.id)}>{row ? '回放' : '载入'}</button></td></tr>;
    })}</tbody></table></div><div className="program-cases-footer"><span>{result ? `${result.rows.filter(row => row.passed).length} / ${cases.length} 通过` : '尚未验证'}{dirty && ' · 测试运行已应用的程序，请先应用修改'}</span>{casePages > 1 && <div className="pagination"><button className="tool-button" aria-label="上一页程序用例" disabled={!shownPage} onClick={() => setCasesPage(page => page - 1)}><ChevronLeft size={14} /></button><span>{shownPage + 1} / {casePages}</span><button className="tool-button" aria-label="下一页程序用例" disabled={shownPage === casePages - 1} onClick={() => setCasesPage(page => page + 1)}><ChevronRight size={14} /></button></div>}</div></section>
    <details className="assembly-help"><summary>汇编示例与调试说明</summary><pre>{`start:  MOVI A, 42       ; 将十进制立即数 42 写入 A
        MOVI B, 0x0D     ; 将十六进制立即数 0x0D 写入 B
        ADD              ; A ← A + B，结果按 8 bit 回绕
        SUB              ; A ← A - B，结果按 8 bit 回绕
        LOAD 0xF0        ; A ← RAM[0xF0]
        STORE 240        ; RAM[240] ← A
        JZ zero          ; Z=1 时跳到标签 zero 处执行，否则继续顺序执行
        JMP 0x0A         ; 无条件跳到 ROM[0x0A] 处执行，也就是标签 done
zero:   OUT              ; 把 A 写入输出寄存器
        NOP              ; 空操作
done:   HLT              ; 停机`}</pre><p>标签以冒号结尾，分号后是注释；数字/地址可写十进制或 0x 十六进制；每个程序最多 256 条指令。Z=1 表示最近一次写入 A 的结果为 0，Z=0 表示结果非 0；只有写入 A 的指令更新 Z，其他指令保持原值。结果按 256 回绕。</p><p>断点在取指前停止，继续会跳过当前位置一次。R 复位会清空 RAM；重新载入题目输入请使用“重启用例”。</p></details>
    {result?.failure?.program && <p className="program-failure-detail" role="alert"><CircleAlert size={15} />{result.failure.scenarioLabel}：{result.failure.program.reason}，已回放到周期{result.failure.cycle}，可继续单步检查。</p>}
  </section>;
}
