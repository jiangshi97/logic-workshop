// 机器观察面板（第 33–44 关编程/架构阶段）：展示真实电路信号 PC/IR/Phase/寄存器等；
// ProgramEditor 是第 38/44 关 ROM 的十六进制指令字编辑器（分页浏览、当前指令高亮）。
import { useState } from 'react';
import { Cpu, FileCode2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CircuitNode, Simulation } from './contracts';
import { decodeInstruction } from './architectureSpec';
import { parseProgramText, formatProgramText } from './programEditor';

/** 指令字的紧凑展示（如 "MOVI A, 5"），非法编码显示提示。 */
export function instructionLabel(word: number): string {
  const instruction = decodeInstruction(word);
  if (!instruction.valid) return '非法编码';
  if (instruction.opcode === 1) return `MOVI ${instruction.param ? 'B' : 'A'}, ${instruction.imm}`;
  return `${instruction.name}${[4, 5, 6, 7].includes(instruction.opcode) ? ` ${instruction.imm}` : ''}`;
}

export function ArchitecturePanel({ simulation, program, onEdit, disabled }: {
  simulation: Simulation; program?: CircuitNode; onEdit: () => void; disabled: boolean;
}) {
  const names = ['PC', 'IR', 'Phase', 'Opcode', 'Param', 'Imm', 'Valid', 'Y', 'Carry', 'Borrow', 'A', 'B', 'Z', 'Memory', 'Q', 'Out', 'Halt', 'Fault', 'Execute', 'WA', 'WB', 'ALUOp', 'MemWrite', 'MemRead', 'Jump', 'OutWrite', 'Invalid'].filter(name => Object.hasOwn(simulation.values, name));
  const phase = simulation.values.Phase;
  const word = simulation.values.IR;
  const pc = simulation.values.PC;
  const words = simulation.activeProgram ?? program?.words ?? [];
  return <section className="architecture-monitor" aria-label="机器观察">
    <h3><Cpu size={15} />机器观察</h3>
    {!!names.length && <dl>{names.map(name => <div key={name}><dt>{name}</dt><dd data-testid={`machine-${name}`}>{simulation.values[name]}</dd></div>)}</dl>}
    {phase !== undefined && <p className="machine-phase">{simulation.values.Fault === 1 ? '非法指令 · 已停止' : simulation.values.Halt === 1 ? '已停止，复位可重启' : `当前阶段：${['取指', '译码', '执行'][Number(phase)] ?? '未知'}`}</p>}
    {typeof word === 'number' && <p className="machine-instruction">IR {word.toString(16).toUpperCase().padStart(4, '0')} · {instructionLabel(word)}</p>}
    {program && <>
      {simulation.activeProgram && <p className="scenario-program" data-testid="scenario-program">正在回放测试程序；清零状态后回到你的 ROM。</p>}
      {typeof pc === 'number' && <p className="machine-instruction" data-testid="program-current">ROM[{pc}] {instructionLabel(words[pc] ?? 0)}</p>}
      <button className="secondary-button" onClick={onEdit} disabled={disabled}><FileCode2 size={14} />编辑 ROM 程序</button>
      <p className="machine-note">{phase !== undefined ? '三个有效周期执行一条普通指令。' : '每个使能沿，IR 捕获旧 PC 对应的 ROM 字。'}单步和运行都使用实际电路。</p>
    </>}
  </section>;
}

export function ProgramEditor({ node, activeProgram, pc, onSave, onClose }: {
  node: CircuitNode; activeProgram?: number[]; pc?: number | string;
  onSave: (words: number[]) => void; onClose: () => void;
}) {
  const [text, setText] = useState(() => formatProgramText(node.words ?? []));
  const [error, setError] = useState('');
  const [page, setPage] = useState(typeof pc === 'number' ? Math.floor(pc / 16) : 0);
  const shown = activeProgram ?? node.words ?? [];
  const save = () => {
    try { const words = parseProgramText(text); onSave(words); }
    catch (failure) { setError((failure as Error).message); }
  };
  return <div className="modal-backdrop" onClick={onClose}><section className="program-dialog" role="dialog" aria-modal="true" aria-labelledby="program-title" onClick={event => event.stopPropagation()}>
    <header><h2 id="program-title">ROM 程序 · {node.label}</h2><button className="tool-button" aria-label="关闭程序编辑器" onClick={onClose}><X size={18} /></button></header>
    <div className="program-editor-body">
      <div className="program-text"><label htmlFor="program-words">每个字为 4 位十六进制，从地址 0 开始</label><textarea id="program-words" aria-label="ROM 程序字" spellCheck={false} value={text} onChange={event => { setText(event.target.value); setError(''); }} />
        <p>例如 1005 = MOVI A, 5；1107 = MOVI B, 7；2000 = ADD；8000 = OUT；9000 = HLT。最多 256 字，未填写的地址为 NOP。</p>
        {error && <p className="program-error" role="alert">{error}</p>}
      </div>
      <div className="program-list"><h3>{activeProgram ? '测试程序（只读观察）' : '已保存的程序'}</h3><table><thead><tr><th>地址</th><th>指令字</th><th>指令</th></tr></thead><tbody>
        {Array.from({ length: 16 }, (_, index) => page * 16 + index).map(address => <tr key={address} className={address === pc ? 'current-instruction' : ''} aria-current={address === pc ? 'step' : undefined}><td>{address.toString(16).toUpperCase().padStart(2, '0')}</td><td>{(shown[address] ?? 0).toString(16).toUpperCase().padStart(4, '0')}</td><td>{instructionLabel(shown[address] ?? 0)}</td></tr>)}
      </tbody></table><div className="pagination"><button className="tool-button" aria-label="上一页程序" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button><span>{page + 1} / 16</span><button className="tool-button" aria-label="下一页程序" disabled={page === 15} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button></div></div>
    </div><footer><p>应用后清零运行状态；修改可撤销，存档会保留程序。</p><div><button className="secondary-button" onClick={onClose}>取消</button><button className="test-button" onClick={save}>应用程序</button></div></footer>
  </section></div>;
}
