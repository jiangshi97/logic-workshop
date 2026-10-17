// React Flow 节点渲染：端口（Handle）、信号着色、门符号 SVG、输入开关/总线输入框。
// 端口同时承担「连线锚点」与「点击连线」两种交互（onPort 回调）。
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Lightbulb, Power, LockKeyhole, Package, Split, Combine, Hash, MemoryStick } from 'lucide-react';
import type { NodeType, Signal, Port, GateType } from './contracts';

export interface CircuitNodeData extends Record<string, unknown> {
  kind: NodeType; label: string; value: Signal; bits: number;
  ports: { inputs: Port[]; outputs: Port[] }; portValues: Record<string, Signal>;
  inputValues: Record<string, Signal>; pending: string | null; failed: boolean;
  readOnly?: boolean; deleted?: boolean; freeInterface?: boolean;
  onToggle: (id: string) => void; onValue: (id: string, value: number) => void;
  onPort: (id: string, handle: string, direction: 'input' | 'output') => void;
}
export type FlowNode = Node<CircuitNodeData, 'circuit'>;
/** 节点渲染尺寸：组件/存储元件更宽，高度随端口数增长；App 用它做画布预量测与空位计算。 */
export function nodeDimensions(kind: NodeType, ports: { inputs: Port[]; outputs: Port[] }) {
  return { width: ['COMPONENT', 'DFF', 'ROM', 'RAM'].includes(kind) ? 180 : 130, height: Math.max(106, 46 + Math.max(ports.inputs.length, ports.outputs.length) * 25) };
}
export function portTop(index: number, total: number) {
  return total <= 2 ? (total === 2 ? 48 + index * 28 : 62) : 48 + index * 25;
}

/** 门符号：组合门用 SVG 绘制经典形状，SPLIT/JOIN/CONST 与存储元件用图标。 */
export function GateSymbol({ type, small = false }: { type: GateType; small?: boolean }) {
  if (type === 'DFF' || type === 'ROM' || type === 'RAM') return <MemoryStick className={small ? 'gate-symbol small' : 'gate-symbol'} aria-label={type === 'DFF' ? 'DFF 触发器' : `${type} 存储器`} />;
  if (type === 'SPLIT' || type === 'JOIN' || type === 'CONST') {
    const Icon = type === 'SPLIT' ? Split : type === 'JOIN' ? Combine : Hash;
    return <Icon className={small ? 'gate-symbol small' : 'gate-symbol'} aria-label={type} />;
  }
  const or = type === 'OR' || type === 'XOR' || type === 'XNOR';
  return <svg className={small ? 'gate-symbol small' : 'gate-symbol'} viewBox="0 0 100 64" aria-label={`${type} 逻辑门`}>
    {type === 'NOT' ? <><path d="M18 8 L18 56 L67 32 Z" /><circle cx="73" cy="32" r="6" /><path d="M5 32 H18 M79 32 H95" /></>
      : <><path d={or ? 'M20 8 Q40 32 20 56 Q64 56 78 32 Q64 8 20 8 Z' : 'M24 8 H47 A24 24 0 0 1 47 56 H24 Z'} />
        {(type === 'XOR' || type === 'XNOR') && <path d="M12 8 Q32 32 12 56" />}
        {(type === 'NAND' || type === 'XNOR') && <circle cx="83" cy="32" r="5" />}
        <path d="M5 20 H24 M5 44 H24 M88 32 H96" /></>}
  </svg>;
}

function signalClass(value: Signal) { return typeof value === 'string' ? 'signal-x' : value > 0 ? 'signal-one' : 'signal-zero'; }
function BusInput({ id, data }: { id: string; data: CircuitNodeData }) {
  const value = typeof data.value === 'number' ? data.value : 0;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const update = (text: string) => {
    setDraft(text);
    if (!text) return;
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    const bounded = Math.min(2 ** data.bits - 1, Math.max(0, Math.trunc(number)));
    if (bounded !== number) setDraft(String(bounded));
    data.onValue(id, bounded);
  };
  return <div className="bus-input nodrag nopan"><input type={data.readOnly ? 'text' : 'number'} min={0} max={2 ** data.bits - 1} aria-label={`输入 ${id}`} readOnly={data.readOnly}
    value={data.readOnly ? data.value : draft} onChange={e => update(e.target.value)} onBlur={() => { if (!data.readOnly) { update(draft || '0'); setDraft(String(Number(draft || '0'))); } }} />
    <small>{typeof data.value === 'number' ? data.value.toString(2).padStart(data.bits, '0') : data.value}</small></div>;
}
export function CircuitNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const isInput = data.kind === 'INPUT';
  const isOutput = data.kind === 'OUTPUT';
  const dimensions = nodeDimensions(data.kind, data.ports);
  const updateNodeInternals = useUpdateNodeInternals();
  const displayBits = isOutput ? data.ports.inputs[0]?.bits : data.ports.outputs[0]?.bits ?? data.bits;
  const displayValue = displayBits === 16 && typeof data.value === 'string' ? 'X' : data.value;
  const portSignature = `${data.kind}:${data.ports.inputs.map(port => `${port.id}:${port.bits}`).join(',')}>${data.ports.outputs.map(port => `${port.id}:${port.bits}`).join(',')}`;
  useEffect(() => { updateNodeInternals(id); }, [id, portSignature, updateNodeInternals]);
  const port = (p: Port, direction: 'input' | 'output', index: number, total: number) => {
    const v = direction === 'output' ? data.portValues[p.id] ?? data.value : data.inputValues[p.id] ?? 'X';
    const top = portTop(index, total);
    return <Handle key={p.id} id={p.id} type={direction === 'input' ? 'target' : 'source'} position={direction === 'input' ? Position.Left : Position.Right}
      style={{ top }} className={`port port-${direction} ${signalClass(v)} ${data.pending === `${id}:${p.id}` ? 'pending' : ''}`}
      data-testid={`port-${id}-${p.id}`} aria-label={`${data.label} ${direction === 'input' ? '输入' : '输出'} ${p.label}`}
      data-tooltip={p.label} role="button" tabIndex={0}
      onClick={event => { event.stopPropagation(); data.onPort(id, p.id, direction); }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); data.onPort(id, p.id, direction); } }}>
      {(total > 2 || ['COMPONENT', 'DFF', 'ROM', 'RAM'].includes(data.kind)) && <span className={`port-label ${direction}`}>{p.label}</span>}
    </Handle>;
  };
  return <div style={dimensions} className={`circuit-node ${isInput || isOutput ? 'io-node' : 'gate-node'} ${signalClass(data.value)} ${selected ? 'selected' : ''} ${data.failed ? 'failed-node' : ''} ${data.deleted ? 'deleted-node' : ''}`}
    data-gate-id={isInput || isOutput ? undefined : id}>
    <div className="node-heading"><span title={data.label}>{data.label}</span><span className="node-kind">{data.deleted ? '已删除' : data.kind === 'COMPONENT' ? '组件' : `${data.bits} bit`}</span></div>
    {isInput ? data.bits === 1 ? <button className="input-switch nodrag nopan" aria-label={`输入 ${id}`} disabled={data.readOnly} aria-pressed={data.value === 1} onClick={() => data.onToggle(id)}>
      <Power size={15} /><span>{data.value}</span><span className="switch-track"><i /></span>
    </button> : <BusInput id={id} data={data} />
      : isOutput ? <div className="lamp-value"><Lightbulb size={24} strokeWidth={1.7} /><strong data-testid={`output-${id}`}>{displayValue}</strong></div>
      : <div className={`gate-body ${['COMPONENT', 'DFF', 'ROM', 'RAM'].includes(data.kind) ? 'component-body' : ''} ${data.kind === 'SPLIT' || data.kind === 'JOIN' ? 'bus-body' : ''}`}>{data.kind === 'COMPONENT' ? <Package size={24} /> : <GateSymbol type={data.kind as GateType} />}<span className="node-signal">{displayValue}</span></div>}
    {data.ports.inputs.map((p, i) => port(p, 'input', i, data.ports.inputs.length))}
    {data.ports.outputs.map((p, i) => port(p, 'output', i, data.ports.outputs.length))}
    {(isInput || isOutput) && !data.freeInterface && <span className="fixed-marker" title="关卡固定端口"><LockKeyhole size={9} /></span>}
  </div>;
}
