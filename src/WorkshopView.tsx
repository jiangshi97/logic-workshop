// 元件工坊：独立于关卡的自定义组件搭建台。
// 电路是 levelId=0 的工坊草稿：INPUT/OUTPUT 自由添加（保存组件时即接口声明）、全部门型可用、
// 框选封装与整图入库复用 components.ts 的既有路径（workshop=true 走不绑定关卡的校验）。
// 交互仿真复用 useSimulation（组合即时求值 + 时钟单步/运行）；草稿持久化于 Workspace.workshop，
// INPUT 开关值不持久化——每次进入都是全新实验。编辑已有组件即载入其内部图，同名保存自动产生新版本。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow,
  type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { Undo2, Redo2, Trash2, RotateCcw, Play, Pause, StepForward, ZoomIn, ZoomOut, Maximize,
  X, Package, Plus, Cable, Clock3, MousePointer2, UnfoldHorizontal, Copy, Power, Lightbulb } from 'lucide-react';
import { addGate, addComponent, getPorts, connect, canConnect, createWorkshopCircuit, removeSelection,
  validateWorkshopCircuit, type Circuit } from './model';
import type { ComponentDefinition, ComponentLibrary, GateType, Inputs } from './contracts';
import { encapsulateSelection, expandComponent, packageCircuit } from './components';
import { activeVariant, groupComponentFamilies, type ComponentFamily } from './libraryGrouping';
import { isCleared } from './progress';
import { useSimulation } from './workerClient';
import { createId } from './id';
import { CircuitNodeView, GateSymbol, nodeDimensions, type FlowNode } from './CircuitNode';
import { WireEdge, type FlowEdge } from './WireEdge';
import { ProgramEditor } from './ArchitecturePanel';
import '@xyflow/react/dist/style.css';

const nodeTypes = { circuit: CircuitNodeView };
const edgeTypes = { wire: WireEdge };
const clone = <T,>(value: T): T => structuredClone(value);
const WORKSHOP_GATES: GateType[] = ['NAND', 'NOT', 'AND', 'OR', 'XOR', 'XNOR', 'SPLIT', 'JOIN', 'CONST', 'DFF', 'ROM', 'RAM'];
const GATE_LABELS: Partial<Record<GateType | 'INPUT' | 'OUTPUT', string>> = {
  NAND: '与非门', NOT: '非门', AND: '与门', OR: '或门', XOR: '异或门', XNOR: '同或门',
  SPLIT: '拆分总线', JOIN: '合并总线', CONST: '常量', DFF: 'D 触发器', ROM: '程序存储器', RAM: '字节存储器',
  INPUT: '输入接口', OUTPUT: '输出接口',
};

function ToolButton({ label, children, onClick, disabled = false, active = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return <button className={`tool-button ${active ? 'active' : ''}`} aria-label={label} data-tooltip={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

interface WorkshopViewProps {
  /** 进入工坊时的草稿：新建为空图，编辑已有组件时为其内部图。 */
  draft: Circuit;
  library: ComponentLibrary;
  teachingLibrary: ComponentLibrary;
  /** 已通关的关卡数，用于过滤教学组件（来源关卡已通关才可用）。 */
  done: number;
  editing?: ComponentDefinition | null;
  onClose: () => void;
  onDraft: (circuit: Circuit) => void;
  onLibrary: (library: ComponentLibrary) => void;
  notify: (message: string) => void;
}

function WorkshopCanvas(props: WorkshopViewProps) {
  const { library, teachingLibrary, done, editing, onClose, onDraft, onLibrary, notify } = props;
  const [circuit, setCircuit] = useState<Circuit>(props.draft);
  const [history, setHistory] = useState<{ past: Circuit[]; future: Circuit[] }>({ past: [], future: [] });
  const [selection, setSelection] = useState<{ nodes: string[]; wires: string[] }>({ nodes: [], wires: [] });
  const [pending, setPending] = useState<{ id: string; handle: string } | null>(null);
  const [inputs, setInputs] = useState<Inputs>({});
  const [busBits, setBusBits] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [packageMode, setPackageMode] = useState<'selection' | 'whole' | null>(null);
  const [componentName, setComponentName] = useState('');
  const [programId, setProgramId] = useState<string | null>(null);
  const [widthChoices, setWidthChoices] = useState<Record<string, number>>({});
  const dragBefore = useRef<Circuit | null>(null);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const mergedLibrary = useMemo(() => ({ ...teachingLibrary, ...library }), [teachingLibrary, library]);
  const inputValues = useMemo(
    () => Object.fromEntries(circuit.nodes.filter(node => node.type === 'INPUT').map(node => [node.id, inputs[node.id] ?? 0])),
    [circuit.nodes, inputs]);
  const simulation = useSimulation(circuit, inputValues, mergedLibrary, epoch);
  const temporal = circuit.nodes.some(node => node.type === 'DFF' || node.type === 'RAM');

  // 关闭前把最新草稿交还存档层持久化。
  useEffect(() => { onDraft(circuit); }, [circuit, onDraft]);

  const commit = useCallback((next: Circuit, previous = circuit) => {
    setCircuit(next);
    setHistory(h => ({ past: [...h.past, clone(previous)].slice(-80), future: [] }));
    setPending(null);
  }, [circuit]);

  const undo = useCallback(() => {
    if (!history.past.length) return;
    const previous = clone(history.past.at(-1)!); previous.revision = circuit.revision + 1;
    setCircuit(previous); onDraft(previous); setPending(null);
    setHistory(h => ({ past: h.past.slice(0, -1), future: [clone(circuit), ...h.future] }));
  }, [history, circuit, onDraft]);

  const redo = useCallback(() => {
    if (!history.future.length) return;
    const next = clone(history.future[0]); next.revision = circuit.revision + 1;
    setCircuit(next); onDraft(next); setPending(null);
    setHistory(h => ({ past: [...h.past, clone(circuit)], future: h.future.slice(1) }));
  }, [history, circuit, onDraft]);

  const applyInputs = useCallback((next: Inputs) => setInputs(previous => ({ ...previous, ...next })), []);

  const vacantPosition = (width: number, height: number) => {
    const occupied = circuit.nodes.map(node => {
      const ports = getPorts(node, mergedLibrary);
      return { ...node.position, ...nodeDimensions(node.type, ports) };
    });
    for (let index = 0; index < 400; index++) {
      const position = { x: 260 + (index % 2) * 200, y: 80 + Math.floor(index / 2) * 170 };
      if (!occupied.some(rect => position.x < rect.x + rect.width + 16 && position.x + width + 16 > rect.x
        && position.y < rect.y + rect.height + 16 && position.y + height + 16 > rect.y)) return position;
    }
    return { x: 260, y: Math.max(...occupied.map(rect => rect.y + rect.height)) + 40 };
  };

  const add = (type: GateType | 'INPUT' | 'OUTPUT', position?: { x: number; y: number }) => {
    const bits = type === 'ROM' ? 16 : type === 'RAM' ? 8 : busBits;
    const desired = position ?? vacantPosition(['DFF', 'ROM', 'RAM', 'COMPONENT'].includes(type) ? 180 : 130,
      ['SPLIT', 'JOIN'].includes(type) ? Math.max(106, 46 + bits * 25) : 146);
    try { commit(addGate(circuit, type, desired, undefined, mergedLibrary, bits, true)); }
    catch (error) { notify((error as Error).message); }
  };

  const placeComponent = (key: string, position?: { x: number; y: number }) => {
    try {
      const definition = library[key] ?? teachingLibrary[key];
      if (!definition) throw new Error('组件依赖缺失。');
      const target: ComponentLibrary = { ...library };
      const include = (dependency: string) => {
        if (target[dependency]) return;
        const block = teachingLibrary[dependency];
        if (!block || (block.sourceLevel !== undefined && !isCleared(block.sourceLevel, done))) throw new Error('先完成这个教学组件的来源关卡。');
        target[dependency] = clone(block);
        block.dependencies.forEach(include);
      };
      include(key);
      const desired = position ?? vacantPosition(180, Math.max(106, 46 + Math.max(definition.inputs.length, definition.outputs.length) * 25));
      const next = addComponent(circuit, key, desired, target, undefined, true);
      commit(next);
      onLibrary(target);
    } catch (error) { notify((error as Error).message); }
  };

  const makeConnection = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return;
    try {
      const endpoints = [connection.source, connection.target].map(id => circuit.nodes.find(node => node.id === id));
      if (endpoints.some(node => node?.type === 'COMPONENT' && mergedLibrary[node.componentKey ?? '']?.deleted)) {
        throw new Error('已删除组件只能从工坊中移除。');
      }
      commit(connect(circuit, connection.source, connection.sourceHandle, connection.target, connection.targetHandle, mergedLibrary, true));
    } catch (error) { notify((error as Error).message); }
  }, [circuit, commit, notify, mergedLibrary]);

  const onPort = useCallback((id: string, handle: string, direction: 'input' | 'output') => {
    const node = circuit.nodes.find(item => item.id === id);
    if (node?.type === 'COMPONENT' && mergedLibrary[node.componentKey ?? '']?.deleted) { notify('已删除组件只能从工坊中移除。'); return; }
    if (direction === 'output') { setPending(p => p?.id === id && p.handle === handle ? null : { id, handle }); return; }
    if (!pending) { notify('先选择一个输出端口。'); return; }
    makeConnection({ source: pending.id, sourceHandle: pending.handle, target: id, targetHandle: handle });
    setPending(null);
  }, [pending, makeConnection, notify, circuit.nodes, mergedLibrary]);

  const deleteSelected = useCallback(() => {
    if (!selection.nodes.length && !selection.wires.length) return;
    const next = removeSelection(circuit, selection.nodes, selection.wires, true);
    if (next.nodes.length === circuit.nodes.length && next.wires.length === circuit.wires.length) return;
    commit(next); setSelection({ nodes: [], wires: [] });
  }, [circuit, selection, commit]);

  const duplicateSelected = useCallback(() => {
    const chosen = circuit.nodes.filter(n => selection.nodes.includes(n.id));
    if (!chosen.length) return;
    let next = circuit;
    const ids = new Map<string, string>();
    try {
      for (const n of chosen) {
        const id = createId('g'); ids.set(n.id, id);
        next = { ...next, revision: next.revision + 1, nodes: [...next.nodes, { ...clone(n), id, position: { x: n.position.x + 32, y: n.position.y + 130 } }] };
      }
      for (const wire of circuit.wires.filter(w => ids.has(w.source) && ids.has(w.target))) {
        next = connect(next, ids.get(wire.source)!, wire.sourceHandle, ids.get(wire.target)!, wire.targetHandle, mergedLibrary, true);
      }
      const error = validateWorkshopCircuit(next, mergedLibrary)[0]; if (error) throw new Error(error);
      commit(next);
    } catch (error) { notify((error as Error).message); }
  }, [selection, circuit, commit, notify, mergedLibrary]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPending(null); setPackageMode(null); setProgramId(null); return; }
      if ((event.target as HTMLElement).closest('input, textarea, select') || packageMode || programId) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelected, packageMode, programId]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => { if (!simulation.pending) simulation.tick(); }, 900);
    return () => clearInterval(timer);
  }, [playing, simulation.pending, simulation.tick]);
  useEffect(() => { if (simulation.error) setPlaying(false); }, [simulation.error]);

  // ---- 保存为组件：整图入库（INPUT/OUTPUT 即接口）或框选封装 ----
  const openPackage = (mode: 'selection' | 'whole') => {
    if (mode === 'whole' && !circuit.nodes.some(node => node.type === 'OUTPUT')) {
      notify('整图保存至少需要一个输出接口：请先放置 OUTPUT 节点。'); return;
    }
    setPackageMode(mode);
    setComponentName(mode === 'whole' ? editing?.name ?? '自定义组件' : '自定义组件');
  };
  const saveComponent = () => {
    try {
      if (!componentName.trim()) throw new Error('请输入组件名称。');
      if (packageMode === 'whole') {
        const packaged = packageCircuit(circuit, componentName.trim(), library, true);
        onLibrary(packaged.library);
      } else {
        const packaged = encapsulateSelection(circuit, selection.nodes, componentName.trim(), library, true);
        onLibrary(packaged.library); commit(packaged.circuit);
        setSelection({ nodes: [], wires: [] });
      }
      setPackageMode(null); notify('组件已保存。');
    } catch (error) { notify((error as Error).message); }
  };

  // ---- 画布数据 ----
  const flowNodes: FlowNode[] = circuit.nodes.map(node => ({ id: node.id, type: 'circuit', position: node.position,
    measured: nodeDimensions(node.type, getPorts(node, mergedLibrary)),
    selected: selection.nodes.includes(node.id), data: {
      kind: node.type, label: node.label, value: node.type === 'INPUT' ? inputValues[node.id] : simulation.values[node.id] ?? 'X', bits: node.bits ?? 1, ports: getPorts(node, mergedLibrary),
      readOnly: false,
      portValues: Object.fromEntries(getPorts(node, mergedLibrary).outputs.map(p => [p.id, node.type === 'INPUT' ? inputValues[node.id] : simulation.portValues[`${node.id}:${p.id}`] ?? 'X'])),
      inputValues: Object.fromEntries(circuit.wires.filter(w => w.target === node.id).map(w => [w.targetHandle, simulation.wires[w.id]])),
      pending: pending ? `${pending.id}:${pending.handle}` : null, failed: false,
      deleted: node.type === 'COMPONENT' && !!mergedLibrary[node.componentKey ?? '']?.deleted,
      freeInterface: node.type === 'INPUT' || node.type === 'OUTPUT',
      onToggle: id => { setPlaying(false); applyInputs({ [id]: (inputs[id] ?? 0) === 1 ? 0 : 1 }); }, onPort,
      onValue: (id, value) => { setPlaying(false); applyInputs({ [id]: Math.trunc(value) }); },
    } }));
  const flowEdges: FlowEdge[] = circuit.wires.map(wire => ({ ...wire, type: 'wire', selected: selection.wires.includes(wire.id),
    data: { value: simulation.wires[wire.id] ?? 'X', bits: getPorts(circuit.nodes.find(n => n.id === wire.source)!, mergedLibrary).outputs.find(p => p.id === wire.sourceHandle)?.bits, failed: false } }));

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.nodes);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, nodes: [...ids] };
    });
    const positions = changes.filter(change => change.type === 'position');
    if (!positions.length) return;
    setCircuit(circuit => ({ ...circuit, nodes: circuit.nodes.map(n => {
      const change = positions.find(p => p.id === n.id);
      return change?.position ? { ...n, position: change.position } : n;
    }) }));
  };

  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.wires);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, wires: [...ids] };
    });
  };

  const selectedNode = circuit.nodes.find(n => selection.nodes.length === 1 && n.id === selection.nodes[0]);
  const teachingEntries = Object.entries(teachingLibrary).filter(([, definition]) =>
    definition.sourceLevel === undefined || isCleared(definition.sourceLevel, done));
  const playerEntries = Object.entries(library).filter(([, definition]) => !definition.deleted && !teachingLibrary[key0(definition)]);
  // 我的组件 / 教学组件按家族分组：多位宽家族顶部给一个小选择框切换位宽，下方列出该位宽的版本。
  const playerFamilies = groupComponentFamilies(playerEntries.map(([key, definition]) => ({ key, definition })));
  const teachingFamilies = groupComponentFamilies(teachingEntries.map(([key, definition]) => ({ key, definition })));
  const widthPicker = (family: ComponentFamily) =>
    <div className="width-picker-row" key={`${family.id}-picker`}>
      <small>{family.baseName}</small>
      <select className="width-picker" aria-label={`${family.baseName} 位宽`} value={activeVariant(family, widthChoices[family.id]).width}
        onChange={event => setWidthChoices(choices => ({ ...choices, [family.id]: Number(event.target.value) }))}>
        {family.widths.map(option => <option key={option.width} value={option.width}>{option.width} 位</option>)}
      </select>
    </div>;

  return <div className="workshop-overlay" role="dialog" aria-modal="true" aria-label="元件工坊">
    <header className="workshop-header">
      <div className="workspace-location"><span className="header-chapter">元件工坊</span>
        <strong>{editing ? `编辑 ${editing.name} v${editing.version}` : '自由搭建自定义组件'}</strong>
        {editing && <span className="level-pill">v{editing.version}</span>}</div>
      <p className="workshop-hint">INPUT / OUTPUT 是组件的对外接口；保存时同名自动产生新版本。</p>
      <ToolButton label="返回关卡" onClick={onClose}><X size={18} /></ToolButton>
    </header>
    <div className="editor-toolbar">
      <div className="toolbar-title"><span className="status-dot" />工坊草稿<span className="toolbar-meta">{circuit.nodes.length} 元件 · {circuit.wires.length} 连接</span></div>
      <div className="edit-tools">
        <ToolButton label="撤销" onClick={undo} disabled={!history.past.length}><Undo2 size={17} /></ToolButton>
        <ToolButton label="重做" onClick={redo} disabled={!history.future.length}><Redo2 size={17} /></ToolButton>
        <span className="tool-divider" />
        <ToolButton label="复制所选" onClick={duplicateSelected} disabled={!selection.nodes.length}><Copy size={16} /></ToolButton>
        <ToolButton label="删除所选" onClick={deleteSelected} disabled={!selection.nodes.length && !selection.wires.length}><Trash2 size={16} /></ToolButton>
        <ToolButton label="封装所选组件" onClick={() => openPackage('selection')} disabled={!selection.nodes.length}><Package size={16} /></ToolButton>
        <ToolButton label="整个草稿保存为组件" onClick={() => openPackage('whole')}><Package size={16} /></ToolButton>
        <ToolButton label="清空工坊" onClick={() => { const next = { ...createWorkshopCircuit(), revision: circuit.revision + 1 }; commit(next); setSelection({ nodes: [], wires: [] }); setEpoch(epoch + 1); }}><RotateCcw size={16} /></ToolButton>
      </div>
      <div className="run-tools">
        {temporal && <span className="clock-count"><Clock3 size={14} />周期 {simulation.state?.cycle ?? 0}</span>}
        {temporal && <ToolButton label={playing ? '暂停时钟' : '运行时钟'} active={playing} disabled={!!simulation.error} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={17} /> : <Play size={17} />}</ToolButton>}
        {temporal && <ToolButton label="单步周期" disabled={simulation.pending} onClick={() => { setPlaying(false); simulation.tick(); }}><StepForward size={18} /></ToolButton>}
        {temporal && <ToolButton label="清零状态" disabled={simulation.pending} onClick={() => { setPlaying(false); simulation.reset(); }}><RotateCcw size={16} /></ToolButton>}
        <button className="test-button" onClick={() => openPackage('whole')}><Package size={16} /><span>保存为组件</span></button>
      </div>
    </div>

    <div className="workshop-shell">
      <aside className="workshop-palette palette-panel" aria-label="工坊元件">
        <div className="sidebar-section-title"><Cable size={14} /><span>接口</span><span className="component-count">2</span></div>
        {(['INPUT', 'OUTPUT'] as const).map(type => <button className="component" key={type} aria-label={`添加 ${GATE_LABELS[type]}`}
          draggable onDragStart={e => { e.dataTransfer.setData('application/logic-gate', type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}>
          <span className="gate-symbol small" aria-hidden>{type === 'INPUT' ? <Power size={26} /> : <Lightbulb size={26} />}</span>
          <span><strong>{type}</strong><small>{GATE_LABELS[type]} · {busBits} bit</small></span><Plus size={15} /></button>)}
        <div className="sidebar-section-title"><Cable size={14} /><span>逻辑元件</span><span className="component-count">{WORKSHOP_GATES.length}</span></div>
        <label className="bus-size">元件位宽<select aria-label="总线位宽" value={busBits} onChange={e => setBusBits(Number(e.target.value))}>
          <option value="1">1 bit</option><option value="2">2 bit</option><option value="4">4 bit</option><option value="8">8 bit</option><option value="16">16 bit</option></select></label>
        {WORKSHOP_GATES.map(type => <button className="component" key={type} aria-label={`添加 ${type}`}
          draggable onDragStart={e => { e.dataTransfer.setData('application/logic-gate', type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}>
          <GateSymbol type={type} small /><span><strong>{type}</strong><small>{GATE_LABELS[type]} · {type === 'ROM' ? 16 : type === 'RAM' ? 8 : busBits} bit</small></span><Plus size={15} /></button>)}
        {!!playerEntries.length && <div className="sidebar-section-title"><Package size={14} /><span>我的组件</span><span className="component-count">{playerEntries.length}</span></div>}
        {playerFamilies.flatMap(family => { const variant = activeVariant(family, widthChoices[family.id]);
          return [...(family.widths.length > 1 ? [widthPicker(family)] : []),
            ...variant.versions.map(({ key, definition }) => <button className="component" key={key} aria-label={`添加组件 ${definition.name}`}
              draggable onDragStart={e => e.dataTransfer.setData('application/logic-component', key)} onClick={() => placeComponent(key)}>
              <Package size={23} /><span><strong>{definition.name}</strong><small>v{definition.version} · {definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span><Plus size={15} /></button>)];
        })}
        {!!teachingEntries.length && <div className="sidebar-section-title"><Package size={14} /><span>教学组件</span><span className="component-count">{teachingEntries.length}</span></div>}
        {teachingFamilies.flatMap(family => { const variant = activeVariant(family, widthChoices[family.id]);
          return [...(family.widths.length > 1 ? [widthPicker(family)] : []),
            ...variant.versions.map(({ key, definition }) => <button className="component" key={key} aria-label={`添加教学组件 ${definition.name}`}
              draggable onDragStart={e => e.dataTransfer.setData('application/logic-component', key)} onClick={() => placeComponent(key)}>
              <Package size={23} /><span><strong>{definition.name}</strong><small>{definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span><Plus size={15} /></button>)];
        })}
      </aside>

      <div className="workshop-board">
        <ReactFlow<FlowNode, FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onConnect={makeConnection} connectOnClick={false} connectionRadius={28}
          isValidConnection={conn => !!conn.sourceHandle && !!conn.targetHandle && canConnect(circuit, conn.source, conn.sourceHandle, conn.target, conn.targetHandle, mergedLibrary, true)}
          onConnectEnd={(_e, state) => { if (!state.isValid && state.toHandle) notify('连接无效：输入已有驱动或会形成反馈回路。'); }}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeDragStart={() => { dragBefore.current = clone(circuit); }}
          onNodeDragStop={(_event, _node, draggedNodes) => {
            const before = dragBefore.current; dragBefore.current = null;
            if (!before) return;
            const moved = new Map(draggedNodes.map(n => [n.id, n.position]));
            const nodes = circuit.nodes.map(n => moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n);
            if (JSON.stringify(before.nodes.map(n => n.position)) !== JSON.stringify(nodes.map(n => n.position))) commit({ ...circuit, nodes, revision: circuit.revision + 1 }, before);
          }}
          onPaneClick={() => { setPending(null); setSelection({ nodes: [], wires: [] }); }}
          onDrop={event => { event.preventDefault(); const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const type = event.dataTransfer.getData('application/logic-gate') as GateType | 'INPUT' | 'OUTPUT'; const key = event.dataTransfer.getData('application/logic-component'); if (type) add(type, position); if (key) placeComponent(key, position); }}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
          fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.08} maxZoom={1.6} snapToGrid snapGrid={[10, 10]}
          panOnDrag={[1, 2]} selectionOnDrag selectionKeyCode={null} deleteKeyCode={null} multiSelectionKeyCode="Shift"
          defaultEdgeOptions={{ type: 'wire' }} attributionPosition="bottom-left">
          <Background variant={BackgroundVariant.Dots} color="#cbd2d7" gap={20} size={1.1} />
        </ReactFlow>
        {pending && <div className="connection-status"><Cable size={14} /><span>{circuit.nodes.find(n => n.id === pending.id)?.label}.{pending.handle}</span><span>→ 输入端口</span><button aria-label="取消连线" onClick={() => setPending(null)}><X size={13} /></button></div>}
        <div className="viewport-tools"><ToolButton label="缩小" onClick={() => void flow.zoomOut({ duration: 150 })}><ZoomOut size={17} /></ToolButton>
          <ToolButton label="放大" onClick={() => void flow.zoomIn({ duration: 150 })}><ZoomIn size={17} /></ToolButton>
          <span className="tool-divider" /><ToolButton label="适应画布" onClick={() => void flow.fitView({ padding: 0.28, duration: 200 })}><Maximize size={16} /></ToolButton></div>
        {simulation.error && <div className="board-error" role="alert">{simulation.error}</div>}
      </div>

      <aside className="workshop-inspector" aria-label="工坊属性">
        {selectedNode ? <>
          <h3>所选对象</h3><h1>{selectedNode.label}</h1>
          <dl><dt>类型</dt><dd>{selectedNode.type === 'COMPONENT' ? '组件' : GATE_LABELS[selectedNode.type] ?? selectedNode.type}</dd>
            <dt>位宽</dt><dd>{selectedNode.type === 'COMPONENT' ? `${getPorts(selectedNode, mergedLibrary).inputs.map(p => p.bits).join(',')} → ${getPorts(selectedNode, mergedLibrary).outputs.map(p => p.bits).join(',')}` : selectedNode.bits ?? 1} bit</dd>
            <dt>当前信号</dt><dd>{selectedNode.type === 'INPUT' ? inputValues[selectedNode.id] : simulation.values[selectedNode.id] ?? 'X'}</dd></dl>
          {selectedNode.type === 'CONST' && <label className="property-input">常量值<input aria-label="常量值" type="number" min="0" max={2 ** (selectedNode.bits ?? 1) - 1} value={selectedNode.value ?? 0}
            onChange={e => { const value = Math.max(0, Math.min(2 ** (selectedNode.bits ?? 1) - 1, Math.trunc(Number(e.target.value)))); commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(n => n.id === selectedNode.id ? { ...n, value } : n) }); }} /></label>}
          {selectedNode.type === 'ROM' && <button className="secondary-button" onClick={() => setProgramId(selectedNode.id)}>编辑 ROM 程序</button>}
          {selectedNode.type === 'COMPONENT' && mergedLibrary[selectedNode.componentKey!]?.deleted
            ? <p className="deleted-component-note">该组件已从组件库删除，请移除此残留实例。</p>
            : selectedNode.type === 'COMPONENT' && <button className="secondary-button" onClick={() => { try { commit(expandComponent(circuit, selectedNode.id, mergedLibrary, true)); setSelection({ nodes: [], wires: [] }); } catch (error) { notify((error as Error).message); } }}><UnfoldHorizontal size={14} />展开组件</button>}
          <button className="secondary-button" onClick={deleteSelected}><Trash2 size={14} />删除所选</button>
        </> : <div className="empty-selection"><MousePointer2 size={26} /><p>选择元件查看属性</p>
          <p className="muted">INPUT/OUTPUT 决定组件接口；保存为组件后可在关卡中放置。</p></div>}
      </aside>
    </div>

    {packageMode && <div className="modal-backdrop" onClick={() => setPackageMode(null)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="workshop-package-title" onClick={e => e.stopPropagation()}>
      <Package size={24} /><h2 id="workshop-package-title">{packageMode === 'whole' ? '保存草稿为组件' : '封装所选组件'}</h2>
      <label className="property-input">组件名称<input autoFocus aria-label="组件名称" maxLength={60} value={componentName} onChange={e => setComponentName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') saveComponent(); if (e.key === 'Escape') setPackageMode(null); }} /></label>
      {packageMode === 'whole' && <p>接口 = 草稿中的全部 INPUT / OUTPUT 节点；同名保存会产生新版本，旧实例不受影响。</p>}
      <div><button className="secondary-button" onClick={() => setPackageMode(null)}>取消</button><button className="test-button" onClick={saveComponent}>保存组件</button></div>
    </section></div>}
    {programId && circuit.nodes.find(n => n.id === programId && n.type === 'ROM') && <ProgramEditor key={`workshop:${programId}`}
      node={circuit.nodes.find(n => n.id === programId)!} pc={simulation.values.PC} onClose={() => setProgramId(null)}
      onSave={words => { commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(n => { if (n.id !== programId) return n; const { programSource: _source, ...node } = n; return { ...node, words }; }) }); setProgramId(null); notify('ROM 程序已应用。'); }} />}
  </div>;
}

/** teachingLibrary 键查询辅助：组件定义不反存自身键，用 id@version 还原。 */
function key0(definition: ComponentDefinition): string { return `${definition.id}@${definition.version}`; }

export function WorkshopView(props: WorkshopViewProps) {
  // 独立的 ReactFlowProvider：工坊画布与关卡画布各自持有实例，互不串扰。
  return <ReactFlowProvider><WorkshopCanvas {...props} /></ReactFlowProvider>;
}
