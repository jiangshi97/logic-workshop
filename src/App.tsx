// 工作区主界面：持有全部游戏状态（存档镜像、撤销历史、判题结果、选择与各类弹窗），
// 组织左侧关卡/组件库栏、中间画布与测试面板、右侧任务面板。电路修改统一走 commit()（压撤销栈 + 取消后台任务）。
// 判题与存档解析在 Worker 中执行（见 workerClient.ts）；交互仿真经 useSimulation 挂钩。
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { CircuitBoard, Check, ChevronRight, ArrowRight, Undo2, Redo2, Trash2, RotateCcw, Play, Pause, StepForward,
  ZoomIn, ZoomOut, Maximize, Download, Upload, LockKeyhole, Lightbulb, X, CircleCheck, CircleAlert,
  Menu, SlidersHorizontal, Cable, Plus, BookOpen, MousePointer2, Copy, Package, UnfoldHorizontal, ChevronLeft, Clock3, Pencil, Eye, Replace, Wrench } from 'lucide-react';
import { addGate, addComponent, getPorts, validateCircuit, connect, canConnect, createCircuit, createWorkshopCircuit, removeSelection, type Circuit } from './model';
import { chapters, levels, getLevel, testInputs, testSequences, type GateType, type Inputs } from './levels';
import type { TestResult, ComponentDefinition, ComponentLibrary } from './contracts';
import { encapsulateSelection, expandComponent, packageCircuit } from './components';
import { backgroundTask, useSimulation } from './workerClient';
import { createId } from './id';
import { loadWorkspace, saveWorkspace, serializeWorkspace, type Workspace } from './storage';
import { componentInterfacesMatch, dependentComponentKeys, graphUsesDeletedComponent, markComponentsDeleted, renameComponent,
  renameComponentInstances, replaceComponentInstance } from './componentManagement';
import { CircuitNodeView, GateSymbol, nodeDimensions, type FlowNode } from './CircuitNode';
import { WireEdge, type FlowEdge } from './WireEdge';
import { CircuitPreview, ComponentPreview } from './ComponentPreview';
import { TimingWaveform } from './TimingWaveform';
import { ArchitecturePanel, ProgramEditor } from './ArchitecturePanel';
import { instructionSet } from './architectureSpec';
import { architectureLibrary } from './architectureCircuits';
import { ProgrammingPanel } from './ProgrammingPanel';
import { programmingCases } from './programmingSpec';
import { WorkshopView } from './WorkshopView';
import '@xyflow/react/dist/style.css';
import './styles.css';

const nodeTypes = { circuit: CircuitNodeView };
const edgeTypes = { wire: WireEdge };
const clone = <T,>(value: T): T => structuredClone(value);

function ToolButton({ label, children, onClick, disabled = false, active = false }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return <button className={`tool-button ${active ? 'active' : ''}`} aria-label={label} data-tooltip={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Workshop() {
  // ---- 基础状态：存档、当前关卡与关卡派生信息 ----
  const [initial] = useState(loadWorkspace);
  const [verifyingInitial, setVerifyingInitial] = useState(initial.savedText !== undefined);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const current = workspace.currentLevel;
  const circuit = workspace.circuits[current];
  const level = getLevel(current);
  const programming = level.mode === 'program';
  const temporal = level.mode === 'sequential' || programming;
  const architecture = level.chapter === 6;
  const teachingLibrary = useMemo(architectureLibrary, []);
  const chapterGroups = useMemo(() => chapters.map((title, index) => ({
    number: index + 1, title, lessons: levels.filter(item => item.chapter === index + 1),
  })), []);
  const inspectionLibrary = useMemo(() => ({ ...teachingLibrary, ...workspace.library }), [teachingLibrary, workspace.library]);
  const inputs = workspace.inputs[current];
  // ---- 编辑器状态：撤销历史、判题结果、连线/选择/提示/弹窗等 ----
  const [history, setHistory] = useState<Record<number, { past: Circuit[]; future: Circuit[] }>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState<{ id: string; handle: string } | null>(null);
  const [selection, setSelection] = useState<{ nodes: string[]; wires: string[] }>({ nodes: [], wires: [] });
  const [hints, setHints] = useState<Record<number, number>>({});
  const [toast, setToast] = useState('');
  const [saveStatus, setSaveStatus] = useState(initial.error ?? '已保存');
  const [resetOpen, setResetOpen] = useState(false);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [panel, setPanel] = useState<'task' | 'selection'>('task');
  const [libraryTab, setLibraryTab] = useState(false);
  const [paletteTab, setPaletteTab] = useState<'available' | 'teaching'>('available');
  const [busy, setBusy] = useState('');
  const [packageMode, setPackageMode] = useState<'selection' | 'whole' | null>(null);
  const [componentName, setComponentName] = useState('');
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [replacementKey, setReplacementKey] = useState('');
  const [inspect, setInspect] = useState<ComponentDefinition | null>(null);
  const [instructionSpecOpen, setInstructionSpecOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [failureOnly, setFailureOnly] = useState(false);
  const [busBits, setBusBits] = useState(4);
  const [fitEpoch, setFitEpoch] = useState(0);
  const [observedStep, setObservedStep] = useState<{ scenarioId: string; stepIndex: number } | null>(null);
  const [testView, setTestView] = useState<'cases' | 'waveform'>('cases');
  const [programId, setProgramId] = useState<string | null>(null);
  const [programDirty, setProgramDirty] = useState(false);
  const [machineVisible, setMachineVisible] = useState(false);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [workshopEditing, setWorkshopEditing] = useState<ComponentDefinition | null>(null);
  const taskAbort = useRef<AbortController | null>(null);
  const taskId = useRef(0);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const dragBefore = useRef<Circuit | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const boardElement = useRef<HTMLDivElement>(null);
  const sidebarScrollPositions = useRef({ levels: 0, library: 0 });
  const restoreLevelScroll = useCallback((element: HTMLElement | null) => { if (element) element.scrollTop = sidebarScrollPositions.current.levels; }, []);
  const restoreLibraryScroll = useCallback((element: HTMLElement | null) => { if (element) element.scrollTop = sidebarScrollPositions.current.library; }, []);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  // 切关/切视野后等待 React Flow 完成节点量测再 fitView，避免对未量测节点计算视野。
  useEffect(() => {
    if (programming) return;
    let frame: number;
    const fitWhenMeasured = () => {
      const nodes = flow.getNodes();
      const ready = nodes.length === circuit.nodes.length && nodes.every(n => {
        const expected = circuit.nodes.find(c => c.id === n.id);
        const measured = flow.getInternalNode(n.id)?.measured;
        return expected && measured?.width && measured?.height;
      });
      if (ready) void flow.fitView({ padding: 0.28 });
      else frame = requestAnimationFrame(fitWhenMeasured);
    };
    frame = requestAnimationFrame(fitWhenMeasured);
    return () => cancelAnimationFrame(frame);
  }, [fitEpoch, current, circuit.nodes.length, flow, programming, machineVisible]);
  const done = Object.keys(workspace.proofs).length;
  const unlocked = Math.min(levels.length, done + 1);
  const currentHistory = history[current] ?? { past: [], future: [] };
  const resultCurrent = result?.revision === circuit.revision;
  const hintCount = hints[current] ?? 0;
  const sequenceRows = useMemo(() => testSequences(current).flatMap(sequence => {
    let cycle = 0;
    return sequence.steps.map((step, stepIndex) => ({ ...step, scenarioId: sequence.id, scenarioLabel: sequence.label, stepIndex, cycle: cycle += Number(step.tick) }));
  }), [current]);
  const caseCount = programming ? programmingCases(current).length : 0;
  const samples = useMemo(() => temporal ? sequenceRows.map(step => step.inputs) : testInputs(current), [current, temporal, sequenceRows]);
  const testCount = programming ? caseCount : samples.length;
  const selectedSample = temporal
    ? sequenceRows.findIndex(row => row.scenarioId === observedStep?.scenarioId && row.stepIndex === observedStep?.stepIndex)
    : samples.findIndex(i => level.inputs.every(name => i[name] === inputs[name]));

  const simulation = useSimulation(circuit, inputs, workspace.library, fitEpoch);
  const hasDeletedComponents = graphUsesDeletedComponent(circuit, workspace.library);
  const rowsToShow = useMemo(() => samples.map((sample, index) => ({ sample, index })).filter(({ index }) => !failureOnly || (resultCurrent && result?.rows[index] && !result.rows[index].passed)), [samples, failureOnly, resultCurrent, result]);
  const pages = Math.max(1, Math.ceil(rowsToShow.length / 8));
  const shownPage = Math.min(page, pages - 1);
  const visibleRows = rowsToShow.slice(shownPage * 8, shownPage * 8 + 8);
  useEffect(() => { if (!failureOnly) setPage(Math.max(0, Math.floor(selectedSample / 8))); }, [selectedSample, failureOnly]);
  useEffect(() => {
    setObservedStep(null); setTestView('cases'); setProgramId(null); setProgramDirty(false); setMachineVisible(false); setBreakpoints([]);
    setBusBits(getLevel(current).chapter === 6 ? Math.max(8, ...getLevel(current).inputPorts.map(p => p.bits)) : getLevel(current).mode === 'sequential' ? Math.max(...getLevel(current).inputPorts.map(p => p.bits)) : 4);
    if (getLevel(current).chapter !== 6) setPaletteTab('available');
  }, [current]);
  useEffect(() => { setObservedStep(null); }, [circuit.revision, fitEpoch]);

  const notify = useCallback((message: string) => setToast(message), []);
  const cancelTask = useCallback(() => { ++taskId.current; taskAbort.current?.abort(); taskAbort.current = null; setBusy(''); setVerifyingInitial(false); }, []);
  // 首次载入：localStorage 里的旧存档需要在 Worker 中重验证明后才替换默认工作区。
  useEffect(() => {
    if (initial.savedText === undefined) return;
    const controller = new AbortController(); taskAbort.current = controller;
    setBusy('验证通关记录');
    void backgroundTask<Workspace>('load', { text: initial.savedText }, controller.signal).then(restored => {
      setWorkspace(restored);
      setPending(null); setSelection({ nodes: [], wires: [] }); setInspect(null); setPackageMode(null); setReplaceTarget(null); setResetOpen(false); setPanel('task');
      setFitEpoch(epoch => epoch + 1);
      setBusy(''); setVerifyingInitial(false);
    }).catch(error => { if (error.name !== 'AbortError') { setBusy(''); setVerifyingInitial(false); setSaveStatus('存档读取失败；新编辑会创建存档'); notify(`存档读取失败：${error.message}`); } });
    return () => controller.abort();
  }, [initial, notify]);
  useEffect(() => () => taskAbort.current?.abort(), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (workspace === initial.workspace || verifyingInitial) return;
    setSaveStatus('保存中');
    saveTimer.current = setTimeout(() => {
      try { saveWorkspace(workspace); setSaveStatus('已保存'); }
      catch { setSaveStatus('保存失败，请导出备份'); }
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [workspace, initial.workspace, verifyingInitial]);
  useEffect(() => {
    const flush = () => { if (workspace === initial.workspace || verifyingInitial) return; try { saveWorkspace(workspace); } catch { /* The persistent status covers storage failure. */ } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [workspace, initial.workspace, verifyingInitial]);

  // ---- 编辑提交：所有电路修改统一入口（压撤销栈、取消后台任务、写入工作区） ----
  const commit = useCallback((next: Circuit, previous = circuit) => {
    if (verifyingInitial) return;
    cancelTask();
    setHistory(h => ({ ...h, [current]: { past: [...(h[current]?.past ?? []), clone(previous)].slice(-80), future: [] } }));
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: next } }));
    setPlaying(false); setPending(null);
  }, [circuit, current, cancelTask, verifyingInitial]);

  const applyInputs = useCallback((next: Inputs) => {
    setObservedStep(null);
    setWorkspace(w => ({ ...w, inputs: { ...w.inputs, [current]: next } }));
  }, [current]);

  const observeSample = useCallback((index: number) => {
    setPlaying(false); applyInputs(samples[index]);
    if (temporal) {
      const row = sequenceRows[index];
      simulation.replay(row.scenarioId, row.stepIndex);
      setObservedStep({ scenarioId: row.scenarioId, stepIndex: row.stepIndex });
    }
  }, [samples, sequenceRows, temporal, applyInputs, simulation.replay]);
  const step = useCallback(() => {
    if (programming) { setObservedStep(null); simulation.programStep(false); }
    else if (temporal) { setObservedStep(null); simulation.tick(); }
    else applyInputs(samples[(selectedSample + 1) % samples.length]);
  }, [programming, temporal, samples, selectedSample, applyInputs, simulation.tick, simulation.programStep]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => { if (!simulation.pending && !busy) { if (programming) simulation.programRun(breakpoints); else step(); } }, programming ? 100 : 900);
    return () => clearInterval(timer);
  }, [playing, step, simulation.pending, busy, programming, breakpoints, simulation.programRun]);
  useEffect(() => { if (simulation.error) setPlaying(false); }, [simulation.error]);
  useEffect(() => { if (programming && !simulation.pending && simulation.program?.stopReason) setPlaying(false); }, [programming, simulation.pending, simulation.program?.stopReason]);
  const toggleRun = () => {
    if (playing) setPlaying(false);
    else { if (programming) { setObservedStep(null); simulation.programRun(breakpoints); } setPlaying(true); }
  };
  const replayProgram = (row: NonNullable<TestResult['failure']>) => {
    setPlaying(false); applyInputs({ E: 1, R: 0 }); simulation.replay(row.scenarioId!, row.stepIndex!);
    setObservedStep({ scenarioId: row.scenarioId!, stepIndex: row.stepIndex! });
  };

  const changeLevel = (id: number) => {
    if (id > unlocked || busy === '验证通关记录') return;
    cancelTask(); setPage(0); setFailureOnly(false);
    setFitEpoch(epoch => epoch + 1);
    setWorkspace(w => ({ ...w, currentLevel: id }));
    setResult(null); setPending(null); setSelection({ nodes: [], wires: [] }); setPlaying(false);
    setChapterOpen(false); setTaskOpen(false); setReplaceTarget(null); setPanel('task');
  };

  const vacantPosition = (width: number, height: number) => {
    const occupied = circuit.nodes.map(node => {
      const ports = getPorts(node, workspace.library);
      return { ...node.position, ...nodeDimensions(node.type, ports) };
    });
    for (let index = 0; index < 400; index++) {
      const position = { x: 300 + (index % 2) * 200, y: 100 + Math.floor(index / 2) * 170 };
      if (!occupied.some(rect => position.x < rect.x + rect.width + 16 && position.x + width + 16 > rect.x
        && position.y < rect.y + rect.height + 16 && position.y + height + 16 > rect.y)) return position;
    }
    return { x: 300, y: Math.max(...occupied.map(rect => rect.y + rect.height)) + 40 };
  };

  const add = (type: GateType, position?: { x: number; y: number }) => {
    if (programming) return;
    const bits = type === 'ROM' ? 16 : type === 'RAM' ? 8 : temporal || architecture || ['SPLIT', 'JOIN', 'CONST'].includes(type) ? busBits : 1;
    const desired = position ?? vacantPosition(['DFF', 'ROM', 'RAM'].includes(type) ? 180 : 130, ['SPLIT', 'JOIN'].includes(type) ? Math.max(106, 46 + bits * 25) : 146);
    try { commit(addGate(circuit, type, desired, undefined, workspace.library, bits)); }
    catch (error) { notify((error as Error).message); }
  };

  const makeConnection = useCallback((connection: Connection) => {
    if (programming) return;
    if (!connection.sourceHandle || !connection.targetHandle) return;
    try {
      const endpoints = [connection.source, connection.target].map(id => circuit.nodes.find(node => node.id === id));
      if (endpoints.some(node => node?.type === 'COMPONENT' && workspace.library[node.componentKey ?? '']?.deleted)) {
        throw new Error('已删除组件只能从关卡中移除。');
      }
      commit(connect(circuit, connection.source, connection.sourceHandle, connection.target, connection.targetHandle, workspace.library));
    }
    catch (error) { notify((error as Error).message); }
  }, [programming, circuit, commit, notify, workspace.library]);

  const onPort = useCallback((id: string, handle: string, direction: 'input' | 'output') => {
    const node = circuit.nodes.find(item => item.id === id);
    if (node?.type === 'COMPONENT' && workspace.library[node.componentKey ?? '']?.deleted) { notify('已删除组件只能从关卡中移除。'); return; }
    if (direction === 'output') { setPending(p => p?.id === id && p.handle === handle ? null : { id, handle }); return; }
    if (!pending) { notify('先选择一个输出端口。'); return; }
    makeConnection({ source: pending.id, sourceHandle: pending.handle, target: id, targetHandle: handle });
    setPending(null);
  }, [pending, makeConnection, notify, circuit.nodes, workspace.library]);

  // ---- 撤销/重做/删除/复制与全局快捷键 ----
  const undo = useCallback(() => {
    const h = history[current]; if (!h?.past.length) return;
    cancelTask();
    const previous = clone(h.past.at(-1)!); previous.revision = circuit.revision + 1;
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: previous } }));
    setHistory(all => ({ ...all, [current]: { past: h.past.slice(0, -1), future: [clone(circuit), ...h.future] } }));
    setPending(null); setPlaying(false);
  }, [history, current, circuit, cancelTask]);

  const redo = useCallback(() => {
    const h = history[current]; if (!h?.future.length) return;
    cancelTask();
    const next = clone(h.future[0]); next.revision = circuit.revision + 1;
    setWorkspace(w => ({ ...w, circuits: { ...w.circuits, [current]: next } }));
    setHistory(all => ({ ...all, [current]: { past: [...h.past, clone(circuit)], future: h.future.slice(1) } }));
    setPending(null); setPlaying(false);
  }, [history, current, circuit, cancelTask]);

  const deleteSelected = useCallback(() => {
    if (programming) return;
    const next = removeSelection(circuit, selection.nodes, selection.wires);
    if (next.nodes.length === circuit.nodes.length && next.wires.length === circuit.wires.length) return;
    commit(next); setSelection({ nodes: [], wires: [] });
  }, [programming, circuit, selection, commit]);

  const duplicateSelected = useCallback(() => {
    if (programming) return;
    const chosen = circuit.nodes.filter(n => selection.nodes.includes(n.id) && n.type !== 'INPUT' && n.type !== 'OUTPUT');
    if (!chosen.length) return;
    let next = circuit;
    const ids = new Map<string, string>();
    try {
      if (chosen.some(node => node.type === 'COMPONENT' && workspace.library[node.componentKey ?? '']?.deleted)) throw new Error('已删除组件不能复制。');
      for (const n of chosen) {
        const id = createId('g'); ids.set(n.id, id);
        next = { ...next, revision: next.revision + 1, nodes: [...next.nodes, { ...clone(n), id, position: { x: n.position.x + 32, y: n.position.y + 130 } }] };
      }
      for (const wire of circuit.wires.filter(w => ids.has(w.source) && ids.has(w.target))) {
        next = connect(next, ids.get(wire.source)!, wire.sourceHandle, ids.get(wire.target)!, wire.targetHandle, workspace.library);
      }
      const error = validateCircuit(next, workspace.library)[0]; if (error) throw new Error(error);
      commit(next);
    } catch (error) { notify((error as Error).message); }
  }, [programming, selection, circuit, commit, notify, workspace.library]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (workshopOpen) return; // 工坊覆盖层打开时，快捷键全部交给工坊内部处理。
      if (event.key === 'Escape') { setPending(null); setChapterOpen(false); setTaskOpen(false); setResetOpen(false); setPackageMode(null); setInspect(null); setRenameTarget(null); setDeleteTarget(null); setReplaceTarget(null); return; }
      if ((event.target as HTMLElement).closest('input, textarea, select') || resetOpen || packageMode || inspect || renameTarget || deleteTarget || replaceTarget) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelected, duplicateSelected, resetOpen, packageMode, inspect, renameTarget, deleteTarget, replaceTarget, workshopOpen]);

  // ---- 测试与关卡导航 ----
  const runTest = async () => {
    if (programming && programDirty) { notify('请先应用汇编修改。'); return; }
    if (hasDeletedComponents) { notify('当前电路包含已删除组件，请先将其移除。'); return; }
    cancelTask();
    const id = ++taskId.current;
    const controller = new AbortController(); taskAbort.current = controller;
    setBusy('测试中');
    setPlaying(false); setPending(null); setPanel('task');
    try {
      const judged = await backgroundTask<TestResult>('judge', { circuit: clone(circuit), library: workspace.library }, controller.signal);
      if (id !== taskId.current || workspaceRef.current.currentLevel !== current || workspaceRef.current.circuits[current].revision !== circuit.revision) return;
      setResult(judged); setBusy(''); setFailureOnly(false);
      if (judged.failure) {
        if (programming) replayProgram(judged.failure);
        else {
        const index = temporal ? sequenceRows.findIndex(row => row.scenarioId === judged.failure!.scenarioId && row.stepIndex === judged.failure!.stepIndex)
          : samples.findIndex(i => level.inputs.every(name => i[name] === judged.failure!.inputs[name]));
        if (index >= 0) { observeSample(index); setPage(Math.floor(index / 8)); }
        }
      }
      if (judged.passed) {
        setWorkspace(w => ({ ...w, proofs: { ...w.proofs, [current]: clone(circuit) } }));
      }
      if (window.innerWidth < 1100) setTaskOpen(true);
    } catch (error) { if ((error as Error).name !== 'AbortError') { setBusy(''); notify((error as Error).message); } }
  };

  // ---- 组件库操作：保存/封装、放置（自动携带教学组件依赖）、重命名/删除/替换 ----
  const openPackage = (mode: 'selection' | 'whole') => { setPackageMode(mode); setComponentName(mode === 'whole' ? level.rewardName ?? level.title : '自定义组件'); };
  const saveComponent = () => {
    try {
      cancelTask();
      if (!componentName.trim()) throw new Error('请输入组件名称。');
      const selectedGraph = packageMode === 'whole' ? circuit : { nodes: circuit.nodes.filter(node => selection.nodes.includes(node.id)), wires: [] };
      if (graphUsesDeletedComponent(selectedGraph, workspace.library)) throw new Error('已删除组件不能保存到新组件中。');
      if (packageMode === 'whole') {
        const packaged = packageCircuit(circuit, componentName.trim(), workspace.library);
        setWorkspace(w => ({ ...w, library: packaged.library }));
      } else {
        const packaged = encapsulateSelection(circuit, selection.nodes, componentName.trim(), workspace.library);
        setWorkspace(w => ({ ...w, library: packaged.library })); commit(packaged.circuit);
        setSelection({ nodes: [], wires: [] });
      }
      setPackageMode(null); setLibraryTab(true); notify('组件已保存。');
    } catch (error) { notify((error as Error).message); }
  };
  const placeComponent = (key: string, position?: { x: number; y: number }) => {
    if (programming) return;
    try {
      const definition = workspace.library[key] ?? teachingLibrary[key];
      if (!definition) throw new Error('组件依赖缺失。');
      const library: ComponentLibrary = { ...workspace.library };
      const include = (dependency: string) => {
        if (library[dependency]) return;
        const block = teachingLibrary[dependency];
        if (!block || !architecture || (block.sourceLevel ?? 0) >= current) throw new Error('先完成这个教学组件的来源关卡。');
        library[dependency] = clone(block);
        block.dependencies.forEach(include);
      };
      include(key);
      const desired = position ?? vacantPosition(180, Math.max(106, 46 + Math.max(definition.inputs.length, definition.outputs.length) * 25));
      const next = addComponent(circuit, key, desired, library);
      commit(next);
      setWorkspace(w => ({ ...w, library }));
    }
    catch (error) { notify((error as Error).message); }
  };

  // ---- 存档导入/导出 ----
  const exportSave = () => {
    const url = URL.createObjectURL(new Blob([serializeWorkspace(workspace, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logic-workshop-save.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('存档已导出。');
  };

  const importSave = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 4_000_000) throw new Error('存档超过 4 MB 限制。');
      cancelTask(); setBusy('验证导入存档');
      const id = ++taskId.current; const controller = new AbortController(); taskAbort.current = controller;
      const imported = await backgroundTask<Workspace>('load', { text: await file.text() }, controller.signal);
      if (id !== taskId.current) return;
      setBusy(''); setPage(0); setFailureOnly(false);
      setFitEpoch(epoch => epoch + 1);
      setWorkspace(imported); setHistory({}); setResult(null); setSelection({ nodes: [], wires: [] }); setPending(null); setPlaying(false);
      setInspect(null); setPackageMode(null); setReplaceTarget(null); setResetOpen(false); setProgramId(null); setPanel('task'); setBreakpoints([]); setProgramDirty(false); setMachineVisible(false);
      notify('存档已导入，通关记录已重新验证。');
    } catch (error) { if ((error as Error).name !== 'AbortError') { setBusy(''); notify(`导入失败：${(error as Error).message}`); } }
    if (importInput.current) importInput.current.value = '';
  };

  const openRename = (key: string) => {
    const definition = workspace.library[key];
    if (!definition || definition.deleted || teachingLibrary[key]) return;
    setRenameTarget(key); setRenameName(definition.name);
  };
  const applyRename = () => {
    if (!renameTarget) return;
    try {
      const name = renameName.trim();
      const renamed = renameComponent(workspace, renameTarget, name);
      setWorkspace(renamed);
      setHistory(all => Object.fromEntries(Object.entries(all).map(([levelId, entry]) => [levelId, {
        past: entry.past.map(item => renameComponentInstances(item, renameTarget, name)),
        future: entry.future.map(item => renameComponentInstances(item, renameTarget, name)),
      }])));
      setRenameTarget(null); notify('组件已重命名。');
    } catch (error) { notify((error as Error).message); }
  };
  const openDelete = (key: string) => {
    if (!workspace.library[key] || teachingLibrary[key]) return;
    const affected = dependentComponentKeys(workspace.library, key);
    if (affected.some(item => teachingLibrary[item])) { notify('内置教学组件不能删除。'); return; }
    setDeleteTarget(key);
  };
  const deleteKeys = deleteTarget ? dependentComponentKeys(workspace.library, deleteTarget) : [];
  const applyDelete = () => {
    if (!deleteTarget) return;
    setWorkspace(value => ({ ...value, library: markComponentsDeleted(value.library, dependentComponentKeys(value.library, deleteTarget)) }));
    setDeleteTarget(null); setInspect(null); setPlaying(false); setPending(null); setResult(null); notify('组件已删除。');
  };

  const showFailure = !!(resultCurrent && result?.failure && level.inputs.every(name => result.failure!.inputs[name] === inputs[name])
    && (!temporal || (!simulation.pending && observedStep?.scenarioId === result.failure.scenarioId && observedStep?.stepIndex === result.failure.stepIndex && simulation.state?.cycle === result.failure.cycle)));
  // Retain dimensions on controlled updates so React Flow keeps visibility and handle bounds.
  // ---- 画布数据：每次渲染重建受控节点/导线，信号值、待连线状态与失败高亮通过 data 下传 ----
  const flowNodes: FlowNode[] = circuit.nodes.map(node => ({ id: node.id, type: 'circuit', position: node.position,
    measured: nodeDimensions(node.type, getPorts(node, workspace.library)),
    selected: selection.nodes.includes(node.id), data: {
      kind: node.type, label: node.label, value: node.type === 'INPUT' ? inputs[node.id] : simulation.values[node.id] ?? 'X', bits: node.bits ?? 1, ports: getPorts(node, workspace.library),
      readOnly: programming && node.type !== 'INPUT',
      portValues: Object.fromEntries(getPorts(node, workspace.library).outputs.map(p => [p.id, node.type === 'INPUT' ? inputs[node.id] : simulation.portValues[`${node.id}:${p.id}`] ?? 'X'])),
      inputValues: Object.fromEntries(circuit.wires.filter(w => w.target === node.id).map(w => [w.targetHandle, simulation.wires[w.id]])),
      pending: pending ? `${pending.id}:${pending.handle}` : null, failed: showFailure && !!result?.failure?.mismatches.includes(node.id),
      deleted: node.type === 'COMPONENT' && !!workspace.library[node.componentKey ?? '']?.deleted,
      onToggle: id => { setPlaying(false); applyInputs({ ...inputs, [id]: inputs[id] === 1 ? 0 : 1 }); }, onPort,
      onValue: (id, value) => { setPlaying(false); applyInputs({ ...inputs, [id]: Math.trunc(value) }); },
    } }));
  const flowEdges: FlowEdge[] = circuit.wires.map(wire => ({ ...wire, type: 'wire', selected: selection.wires.includes(wire.id),
    data: { value: simulation.wires[wire.id] ?? 'X', bits: getPorts(circuit.nodes.find(n => n.id === wire.source)!, workspace.library).outputs.find(p => p.id === wire.sourceHandle)?.bits,
      failed: showFailure && !!result?.failure?.mismatches.includes(wire.target) } }));

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.nodes);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, nodes: [...ids] };
    });
    const positions = changes.filter(change => change.type === 'position');
    if (!positions.length) return;
    setWorkspace(w => {
      const currentCircuit = w.circuits[current];
      return { ...w, circuits: { ...w.circuits, [current]: { ...currentCircuit,
        nodes: currentCircuit.nodes.map(n => {
          const change = positions.find(p => p.id === n.id);
          return change?.position ? { ...n, position: change.position } : n;
        }) } } };
    });
  };

  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const ids = new Set(previous.wires);
      for (const change of selected) change.selected ? ids.add(change.id) : ids.delete(change.id);
      return { ...previous, wires: [...ids] };
    });
  };

  const selectedNode = circuit.nodes.find(n => selection.nodes.includes(n.id));
  const selectedWire = circuit.wires.find(w => selection.wires.includes(w.id));
  const hasEditableSelection = !programming && circuit.nodes.some(n => selection.nodes.includes(n.id) && n.type !== 'INPUT' && n.type !== 'OUTPUT');
  const selectionUsesDeleted = circuit.nodes.some(n => selection.nodes.includes(n.id) && n.type === 'COMPONENT' && workspace.library[n.componentKey ?? '']?.deleted);
  const visibleLibraryEntries = Object.entries(workspace.library).filter(([key, definition]) => !definition.deleted && (!teachingLibrary[key] || (definition.sourceLevel ?? 0) < current));
  // 组件库按名称家族分组：同名各版本聚合展示（最新在前），解决不同位宽/历史版本分散难找的问题。
  const libraryFamilies = useMemo(() => {
    const families = new Map<string, { key: string; definition: ComponentDefinition }[]>();
    for (const entry of visibleLibraryEntries) {
      const versions = families.get(entry[1].name) ?? [];
      versions.push({ key: entry[0], definition: entry[1] });
      families.set(entry[1].name, versions);
    }
    return [...families.entries()].map(([name, versions]) => ({
      name,
      versions: [...versions].sort((left, right) => right.definition.version - left.definition.version),
    })).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [visibleLibraryEntries]);
  // 打开元件工坊：不传定义即继续/新建草稿；传入定义则载入其内部图供修改（同名保存出新版本）。
  const openWorkshop = (definition?: ComponentDefinition) => {
    if (busy === '验证通关记录') return;
    cancelTask();
    setWorkshopEditing(definition ?? null);
    setWorkshopOpen(true);
  };
  const handleWorkshopDraft = useCallback((draft: Circuit) => {
    setWorkspace(w => ({ ...w, workshop: draft }));
  }, []);
  const handleWorkshopLibrary = useCallback((library: ComponentLibrary) => {
    setWorkspace(w => ({ ...w, library }));
  }, []);
  const replaceableNode = !programming && selection.nodes.length === 1 && selectedNode?.type === 'COMPONENT' ? selectedNode : null;
  const replacementNode = replaceTarget ? circuit.nodes.find(node => node.id === replaceTarget && node.type === 'COMPONENT') : undefined;
  const replacementSource = replacementNode?.type === 'COMPONENT' ? workspace.library[replacementNode.componentKey ?? ''] : undefined;
  const replacementPool = new Map<string, ComponentDefinition>([
    ...Object.entries(workspace.library).filter(([key, definition]) => !definition.deleted && !teachingLibrary[key]),
    ...(architecture ? Object.entries(teachingLibrary).filter(([, definition]) => (definition.sourceLevel ?? 0) < current) : []),
  ]);
  const replacementCandidates = replacementSource ? [...replacementPool.entries()]
    .filter(([key, definition]) => key !== replacementNode?.componentKey && componentInterfacesMatch(replacementSource, definition))
    .sort(([, left], [, right]) => left.name.localeCompare(right.name, 'zh-CN') || right.version - left.version) : [];
  const openReplace = (nodeId: string) => { setReplaceTarget(nodeId); setReplacementKey(''); };
  const applyReplacement = () => {
    if (!replaceTarget || !replacementKey) return;
    try {
      const library: ComponentLibrary = { ...workspace.library };
      const include = (key: string) => {
        if (library[key] && !library[key].deleted) return;
        const definition = teachingLibrary[key];
        if (!definition || !architecture || (definition.sourceLevel ?? 0) >= current) throw new Error('替换组件当前不可用。');
        library[key] = clone(definition);
        definition.dependencies.forEach(include);
      };
      include(replacementKey);
      const next = replaceComponentInstance(circuit, replaceTarget, replacementKey, library);
      commit(next);
      setWorkspace(value => ({ ...value, library }));
      setReplaceTarget(null); setReplacementKey(''); notify('组件实例已替换。');
    } catch (error) { notify((error as Error).message); }
  };

  return <div className={`workshop ${temporal ? 'temporal-workshop' : ''} ${programming ? 'programming-workshop' : ''}`}>
    <aside className={`sidebar ${chapterOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><CircuitBoard size={23} /></span><div><strong>逻辑工坊</strong><span>LOGIC WORKSHOP</span></div>
        <button className="close-sidebar tool-button" aria-label="关闭关卡目录" onClick={() => setChapterOpen(false)}><X size={18} /></button></div>
      <div className="library-tabs"><button className={!libraryTab ? 'chosen' : ''} onClick={() => setLibraryTab(false)}><BookOpen size={14} />关卡</button><button className={libraryTab ? 'chosen' : ''} onClick={() => setLibraryTab(true)}><Package size={14} />组件库 <small>{visibleLibraryEntries.length}</small></button></div>
      <div className="sidebar-scroll">
      {!libraryTab ? <nav ref={restoreLevelScroll} className="lesson-list" aria-label="关卡" onScroll={event => { sidebarScrollPositions.current.levels = event.currentTarget.scrollTop; }}>
        {chapterGroups.map(group => <Fragment key={group.number}>
          <div className={`lesson-chapter ${group.number === level.chapter ? 'active' : ''}`}>
            <span>第 {group.number} 章</span><strong>{group.title}</strong>
            <small>{String(group.lessons[0].id).padStart(2, '0')}–{String(group.lessons.at(-1)!.id).padStart(2, '0')}</small>
          </div>
          {group.lessons.map(item => <button key={item.id} className={`lesson ${item.id === current ? 'current' : ''}`} disabled={item.id > unlocked}
            aria-label={`第 ${item.id} 关 ${item.title}`} aria-current={item.id === current ? 'step' : undefined} onClick={() => changeLevel(item.id)}>
            <span className={`lesson-number ${workspace.proofs[item.id] ? 'completed' : ''}`}>
              {item.id > unlocked ? <LockKeyhole size={12} /> : String(item.id).padStart(2, '0')}
            </span>
            <span className="lesson-copy"><strong>{item.title}</strong><small>{item.caption}</small></span>
            {item.id === current && <ChevronRight size={15} />}
          </button>)}
        </Fragment>)}
      </nav> : <section ref={restoreLibraryScroll} className="saved-components" aria-label="组件库" onScroll={event => { sidebarScrollPositions.current.library = event.currentTarget.scrollTop; }}>
        <button className="workshop-open-button" aria-label="打开元件工坊" disabled={busy === '验证通关记录'} onClick={() => openWorkshop()}><Wrench size={15} /><span>元件工坊</span><span className="workshop-open-hint">自由搭建元件</span></button>
        {libraryFamilies.map(family => <div className="library-family" key={family.name}>
          {family.versions.map(({ key, definition }, index) => <div className="library-item" key={key} style={index ? { paddingLeft: 16 } : undefined}>
          <button className="component" aria-label={`添加组件 ${definition.name} v${definition.version}`} disabled={programming} draggable={!programming} onDragStart={e => e.dataTransfer.setData('application/logic-component', key)} onClick={() => placeComponent(key)}>
            <Package size={23} /><span><strong>{definition.name}</strong><small>v{definition.version}{index === 0 && family.versions.length > 1 ? ' · 最新' : ''} · {definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span><Plus size={15} /></button>
          <div className="library-actions"><ToolButton label="查看内部电路" onClick={() => setInspect(definition)}><Eye size={14} /></ToolButton>
            {!teachingLibrary[key] && <><ToolButton label={`在工坊中编辑 ${definition.name} v${definition.version}`} onClick={() => openWorkshop(definition)}><Wrench size={13} /></ToolButton><ToolButton label={`重命名 ${definition.name} v${definition.version}`} onClick={() => openRename(key)}><Pencil size={13} /></ToolButton><ToolButton label={`删除 ${definition.name} v${definition.version}`} onClick={() => openDelete(key)}><Trash2 size={13} /></ToolButton></>}
          </div>
        </div>)}
        </div>)}
        {!visibleLibraryEntries.length && <p className="library-empty">组件库为空</p>}
      </section>}
      {architecture && <div className="palette-tabs" role="tablist" aria-label="组件区域"><button role="tab" aria-selected={paletteTab === 'available'} className={paletteTab === 'available' ? 'chosen' : ''} onClick={() => setPaletteTab('available')}><Cable size={14} />基础组件</button><button role="tab" aria-selected={paletteTab === 'teaching'} className={paletteTab === 'teaching' ? 'chosen' : ''} onClick={() => setPaletteTab('teaching')}><Package size={14} />教学组件</button></div>}
      {architecture && paletteTab === 'teaching' && <section className="teaching-components palette-panel" aria-label="教学组件"><p>已学模块，可查看内部电路或使用自己的作品。</p>
        {Object.entries(teachingLibrary).filter(([, definition]) => (definition.sourceLevel ?? 0) < current).map(([key, definition]) => <div className="library-item" key={key}>
          <button className="component" aria-label={`添加教学组件 ${definition.name}`} draggable onDragStart={e => e.dataTransfer.setData('application/logic-component', key)} onClick={() => placeComponent(key)}><Package size={23} /><span><strong>{definition.name}</strong><small>{definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span><Plus size={15} /></button>
          <div className="library-actions"><ToolButton label={`查看教学组件 ${definition.name}`} onClick={() => setInspect(definition)}><Eye size={14} /></ToolButton></div>
        </div>)}
      </section>}
      {!programming && (!architecture || paletteTab === 'available') && <div className="components-section palette-panel">{!architecture && <div className="sidebar-section-title"><Cable size={14} /><span>可用组件</span><span className="component-count">{level.allowed.length}</span></div>}
        {level.allowed.includes('SPLIT') && <label className="bus-size">元件位宽<select aria-label="总线位宽" value={busBits} onChange={e => setBusBits(Number(e.target.value))}>{level.allowed.includes('CONST') && <option value="1">1 bit</option>}<option value="2">2 bit</option><option value="4">4 bit</option>{(temporal || architecture) && <option value="8">8 bit</option>}{architecture && <option value="16">16 bit</option>}</select></label>}
        {level.allowed.length === 0 ? <div className="wire-component"><Cable size={26} /><div><strong>导线</strong><span>1 bit</span></div></div> : level.allowed.map(type =>
          <button className="component" key={type} aria-label={`添加 ${type}`} draggable onDragStart={e => { e.dataTransfer.setData('application/logic-gate', type); e.dataTransfer.effectAllowed = 'copy'; }} onClick={() => add(type)}>
            <GateSymbol type={type} small /><span><strong>{type}</strong><small>{({ NAND: '与非门', NOT: '非门', AND: '与门', OR: '或门', XOR: '异或门', XNOR: '同或门', SPLIT: '拆分总线', JOIN: '合并总线', CONST: '常量', DFF: 'D 触发器', ROM: '程序存储器', RAM: '字节存储器' })[type]} · {type === 'ROM' ? 16 : type === 'RAM' ? 8 : temporal || architecture || ['SPLIT', 'JOIN', 'CONST'].includes(type) ? busBits : 1} bit</small></span><Plus size={15} />
          </button>)}
      </div>}
      {programming && <div className="programming-sidebar-note"><strong>从电路到程序</strong><p>本阶段使用上一阶段的八位计算机。编写汇编，观察取指与执行，再用多组输入验证算法。CPU结构固定，可查看内部电路。</p></div>}
      </div>
      <div className="sidebar-progress"><div><span>总进度</span><strong data-testid="progress-count">{done} / {levels.length}</strong></div><div className="progress-track"><i style={{ width: `${done / levels.length * 100}%` }} /></div></div>
      <div className="sidebar-footer"><span className="footer-dot" /><span>从信号到程序</span><span className="version">v0.5</span></div>
    </aside>

    <main className="main-workspace">
      <header className="workspace-header"><div className="workspace-location">
        <ToolButton label="查看关卡" onClick={() => setChapterOpen(true)}><Menu size={19} /></ToolButton>
        <span className="mobile-brand">逻辑工坊</span><span className="header-chapter">第 {level.chapter} 章</span><ChevronRight size={14} /><strong>{level.title}</strong><span className="level-pill">{String(current).padStart(2, '0')}</span>
      </div><div className={`save-status ${saveStatus.includes('失败') ? 'save-error' : ''}`}><span />{saveStatus}</div>
        <div className="file-tools"><ToolButton label="导出存档" onClick={exportSave}><Download size={17} /></ToolButton><ToolButton label="导入存档" onClick={() => importInput.current?.click()}><Upload size={17} /></ToolButton></div>
        <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={e => void importSave(e.target.files?.[0])} />
      </header>

      <div className="editor-toolbar"><div className="toolbar-title"><span className="status-dot" />电路工作区<span className="toolbar-meta">{circuit.nodes.length - level.inputs.length - level.outputPorts.length} 元件 · {circuit.wires.length} 连接</span></div>
        <div className="edit-tools"><ToolButton label="撤销" onClick={undo} disabled={!currentHistory.past.length}><Undo2 size={17} /></ToolButton>
          <ToolButton label="重做" onClick={redo} disabled={!currentHistory.future.length}><Redo2 size={17} /></ToolButton>
          <span className="tool-divider" /><ToolButton label="复制所选组件" onClick={duplicateSelected} disabled={!hasEditableSelection || selectionUsesDeleted}><Copy size={16} /></ToolButton>
          <ToolButton label="替换组件" disabled={!replaceableNode} onClick={() => { if (replaceableNode) openReplace(replaceableNode.id); }}><Replace size={16} /></ToolButton>
          <ToolButton label="删除所选" onClick={deleteSelected} disabled={programming || (!selection.wires.length && !hasEditableSelection)}><Trash2 size={16} /></ToolButton>
          <ToolButton label="封装所选组件" onClick={() => openPackage('selection')} disabled={!hasEditableSelection || selectionUsesDeleted}><Package size={16} /></ToolButton>
          <ToolButton label={programming ? '清空当前程序' : '重置当前电路'} onClick={() => setResetOpen(true)}><RotateCcw size={16} /></ToolButton>
        </div><div className="run-tools">{temporal && <span className="clock-count" data-testid="clock-cycle"><Clock3 size={14} />周期 {simulation.state?.cycle ?? 0}</span>}
          <ToolButton label={programming ? playing ? '暂停程序' : '运行程序' : temporal ? playing ? '暂停时钟' : '运行时钟' : playing ? '暂停用例' : '播放用例'} active={playing} disabled={hasDeletedComponents || !!busy || (programming && (programDirty || (!playing && simulation.pending)))} onClick={toggleRun}>{playing ? <Pause size={17} /> : <Play size={17} />}</ToolButton>
          <ToolButton label={temporal ? '单步周期' : '下一组输入'} disabled={hasDeletedComponents || (temporal && (simulation.pending || !!busy))} onClick={() => { setPlaying(false); step(); }}><StepForward size={18} /></ToolButton>
          {temporal && <ToolButton label="清零状态" disabled={simulation.pending || !!busy} onClick={() => { setPlaying(false); setObservedStep(null); simulation.reset(); }}><RotateCcw size={16} /></ToolButton>}
          {busy ? <button className="test-button" aria-label="取消后台任务" onClick={cancelTask}><X size={16} /><span>{busy}</span></button> : <button className="test-button" aria-label={programming ? '测试程序' : '测试电路'} disabled={hasDeletedComponents || (programming && programDirty)} onClick={() => void runTest()}><CircleCheck size={16} /><span>{programming ? '测试程序' : '测试电路'}</span></button>}
          <button className="task-toggle tool-button" aria-label="查看任务" data-tooltip="查看任务" onClick={() => setTaskOpen(true)}><SlidersHorizontal size={18} /></button>
        </div>
      </div>

      <div className="editor-content">
        <section className={`board-area ${programming && machineVisible ? 'machine-first' : ''}`} aria-label="电路画布">
          {programming && <ProgrammingPanel key={`${current}:${fitEpoch}`} levelId={current} node={circuit.nodes.find(node => node.id === 'program')!} simulation={simulation} result={resultCurrent ? result : null} busy={!!busy} playing={playing} inputs={inputs} onInputs={next => { setPlaying(false); applyInputs(next); }} breakpoints={breakpoints} onBreakpoints={setBreakpoints} onDirty={setProgramDirty} onEditing={() => setPlaying(false)}
            onApply={(words, programSource) => { commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(node => node.id === 'program' ? { ...node, words, programSource } : node) }); setFitEpoch(epoch => epoch + 1); notify('汇编已应用，当前用例已重新载入。'); }}
            onStep={() => { setPlaying(false); setObservedStep(null); simulation.programStep(true); }} onCycle={() => { setPlaying(false); step(); }} onRun={toggleRun}
            onRestart={() => { setPlaying(false); setObservedStep(null); simulation.reset(); }} onCase={caseId => { setPlaying(false); setObservedStep(null); applyInputs({ E: 1, R: 0 }); simulation.programCase(caseId); }} onReplay={replayProgram}
            machineVisible={machineVisible} onMachineView={() => setMachineVisible(visible => !visible)} />}
          <div className={`board ${programming && !machineVisible ? 'programming-machine-hidden' : ''}`} ref={boardElement}>
            {programming && machineVisible ? <div className="machine-preview"><CircuitPreview graph={circuit} library={inspectionLibrary} signals={{ values: { ...simulation.values, ...inputs }, portValues: simulation.portValues, wires: simulation.wires }} /></div> : <ReactFlow<FlowNode, FlowEdge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              nodesConnectable={!programming}
              onConnect={makeConnection} connectOnClick={false} connectionRadius={28}
              isValidConnection={conn => !!conn.sourceHandle && !!conn.targetHandle && canConnect(circuit, conn.source, conn.sourceHandle, conn.target, conn.targetHandle, workspace.library)}
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
              onDrop={event => { event.preventDefault(); const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }); const type = event.dataTransfer.getData('application/logic-gate') as GateType; const key = event.dataTransfer.getData('application/logic-component'); if (level.allowed.includes(type)) add(type, position); if (key) placeComponent(key, position); }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
              fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.08} maxZoom={1.6} snapToGrid snapGrid={[10, 10]}
              panOnDrag={[1, 2]} selectionOnDrag selectionKeyCode={null} deleteKeyCode={null} multiSelectionKeyCode="Shift"
              defaultEdgeOptions={{ type: 'wire' }} attributionPosition="bottom-left">
              <Background variant={BackgroundVariant.Dots} color="#cbd2d7" gap={20} size={1.1} />
            </ReactFlow>}
            <div className="board-labels"><span>输入</span><span>输出</span></div>
            <div className="board-legend"><span><i className="legend-one" />1</span><span><i className="legend-zero" />0</span><span><i className="legend-x" />X</span></div>
            {pending && <div className="connection-status"><Cable size={14} /><span>{circuit.nodes.find(n => n.id === pending.id)?.label}.{pending.handle}</span><ArrowRight size={13} /><span>输入端口</span><button aria-label="取消连线" onClick={() => setPending(null)}><X size={13} /></button></div>}
            <div className="viewport-tools"><ToolButton label="缩小" onClick={() => void flow.zoomOut({ duration: 150 })}><ZoomOut size={17} /></ToolButton>
              <ToolButton label="放大" onClick={() => void flow.zoomIn({ duration: 150 })}><ZoomIn size={17} /></ToolButton>
              <span className="tool-divider" /><ToolButton label="适应画布" onClick={() => void flow.fitView({ padding: 0.28, duration: 200 })}><Maximize size={16} /></ToolButton></div>
            {simulation.error && <div className="board-error" role="alert">{simulation.error}</div>}
          </div>

          {!programming && <section className="test-panel" aria-label="测试用例">
            <div className="test-panel-heading"><div><span className="panel-label">{temporal ? '时序测试' : level.cases ? '测试集合' : '真值表'}</span><span className="muted">{samples.length} {temporal ? '步观察' : '组输入'}</span></div>{temporal
              ? <div className="timing-tabs"><button className={testView === 'cases' ? 'chosen' : ''} onClick={() => setTestView('cases')}>测试序列</button><button className={testView === 'waveform' ? 'chosen' : ''} onClick={() => setTestView('waveform')}>波形记录</button></div>
              : <div className="sample-indicator"><span className={playing ? 'playing-dot' : ''} />{playing ? '播放中' : '当前输入'}<strong>{String(selectedSample + 1).padStart(2, '0')}</strong><span>/ {String(samples.length).padStart(2, '0')}</span></div>}</div>
            {temporal && testView === 'waveform' ? <TimingWaveform frames={simulation.trace ?? []} inputs={level.inputPorts} outputs={level.outputPorts} />
              : <div className="test-table-wrap"><table><thead><tr><th className="row-number">用例</th>{temporal && <><th>场景</th><th>沿 / 周期</th></>}{level.inputs.map(name => <th key={name}>{name}</th>)}{level.outputPorts.map(p => <th key={p.id}>期望 {p.label}</th>)}{level.outputPorts.map(p => <th key={p.id}>实际 {p.label}</th>)}<th>结果</th></tr></thead>
              <tbody>{visibleRows.map(({ sample, index }) => {
                const row = resultCurrent ? result?.rows[index] : undefined;
                const timing = sequenceRows[index];
                const expected = temporal ? timing.expectedOutputs : level.expectedOutputs(sample);
                return <tr key={index} className={`${index === selectedSample ? 'active-row' : ''} ${row && !row.passed ? 'failed-row' : ''}`} onClick={() => observeSample(index)}>
                  <td><button aria-label={`观察用例 ${index + 1}`} onClick={event => { event.stopPropagation(); observeSample(index); }}><span className="row-cursor">{index === selectedSample ? <ChevronRight size={12} /> : null}</span>{String(index + 1).padStart(2, '0')}</button></td>
                  {temporal && <><td className="scenario-label" title={timing.scenarioLabel}>{timing.scenarioLabel} · {timing.stepIndex + 1}</td><td>{timing.tick ? '↑' : '·'} {timing.cycle}</td></>}
                  {level.inputs.map(name => <td key={name}>{sample[name]}</td>)}{level.outputPorts.map(p => <td key={`expected-${p.id}`}>{expected[p.id]}</td>)}
                  {level.outputPorts.map(p => { const actual = row?.actualOutputs[p.id] ?? (index === selectedSample ? simulation.values[p.id] ?? 'X' : '-'); const mismatched = row?.mismatches.includes(p.id); return <td key={`actual-${p.id}`} className={`${typeof actual === 'string' && actual.includes('X') ? 'unknown-cell' : ''} ${mismatched ? 'mismatch-cell' : ''}`}>{actual}</td>; })}
                  <td>{row ? <span className={`table-status ${row.passed ? 'pass' : 'fail'}`}>{row.passed ? <Check size={12} /> : <X size={12} />}{row.passed ? '通过' : '不一致'}</span> : <span className="untested">待测试</span>}</td>
                </tr>;
              })}</tbody></table></div>}
            <div className="test-panel-footer"><span>{resultCurrent && result ? `${result.rows.filter(r => r.passed).length} / ${samples.length} 通过` : '尚未验证'}{simulation.pending && ' · 信号计算中'}</span>
              {samples.length > 8 && (!temporal || testView === 'cases') && <div className="pagination"><label><input type="checkbox" checked={failureOnly} disabled={!resultCurrent} onChange={e => { setFailureOnly(e.target.checked); setPage(0); }} />仅失败</label><ToolButton label="上一页用例" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!shownPage}><ChevronLeft size={14} /></ToolButton><span>{shownPage + 1} / {pages}</span><ToolButton label="下一页用例" onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={shownPage === pages - 1}><ChevronRight size={14} /></ToolButton></div>}
            </div>
          </section>}
        </section>

        <aside className={`task-panel ${taskOpen ? 'mobile-open' : ''}`}>
          <div className="task-tabs"><button className={panel === 'task' ? 'chosen' : ''} onClick={() => setPanel('task')}>任务</button><button className={panel === 'selection' ? 'chosen' : ''} onClick={() => setPanel('selection')}>属性</button>
            <button className="close-task tool-button" aria-label="关闭任务" onClick={() => setTaskOpen(false)}><X size={18} /></button></div>
          <div className="task-panel-scroll">
            {panel === 'task' ? <><div className="task-eyebrow">关卡 {String(current).padStart(2, '0')}<span>{workspace.proofs[current] ? '已完成' : '进行中'}</span></div>
              <h1>{level.title}</h1>
              {architecture && <ArchitecturePanel simulation={simulation} program={circuit.nodes.find(n => n.id === 'program' && n.type === 'ROM')} disabled={!!busy} onEdit={() => { setPlaying(false); setProgramId('program'); }} />}
              {programming && <ArchitecturePanel simulation={simulation} disabled={!!busy} onEdit={() => {}} />}
              <div className="goal-section"><h3>目标</h3><p>{level.goal}</p><div className="formula">{level.formula}</div>
                {architecture && current >= 37 && <button className="secondary-button instruction-spec-button" onClick={() => setInstructionSpecOpen(true)}><BookOpen size={14} />查看指令规范</button>}
              </div>
              {temporal && <div className="timing-help"><Clock3 size={15} /><p>改变输入不会推进时钟。单步周期让全部 DFF 同时采样旧值，再更新输出。清零状态只重启试验；复位输入 R 需要在时钟沿生效。</p></div>}
              <div className="interface-section"><h3>接口</h3>{level.inputPorts.map(p => <div key={p.id}><span>输入</span><strong>{p.label}</strong><small>{p.bits} bit</small></div>)}{level.outputPorts.map(p => <div key={p.id}><span>输出</span><strong>{p.label}</strong><small>{p.bits} bit</small></div>)}</div>
              <div className="hint-section"><div><h3>思路提示</h3><span>{hintCount} / 3</span></div>
                {level.hints.slice(0, hintCount).map((hint, index) => <p key={hint}><span>0{index + 1}</span>{hint}</p>)}
                <button className="hint-button" disabled={hintCount === 3} onClick={() => setHints(h => ({ ...h, [current]: Math.min(3, (h[current] ?? 0) + 1) }))}><Lightbulb size={15} />{hintCount === 3 ? '提示已全部展开' : hintCount ? '下一条提示' : '展开提示'}<ChevronRight size={14} /></button>
              </div>
              <div className={`test-feedback ${resultCurrent && result?.passed ? 'passed' : resultCurrent && result ? 'not-passed' : ''}`} data-testid="test-feedback" aria-live="polite">
                {resultCurrent && result ? result.passed ? <><CircleCheck size={23} /><strong>{testCount} / {testCount} {level.cases ? '测试集通过' : '全部通过'}</strong><p>{current === levels.length ? '编程应用阶段完成，全部56关已交付。可以导出你的作品。' : programming ? '程序通过公开测试，下一关已解锁。' : '电路正确，下一关已解锁。'}</p>
                  {!programming && <button className="secondary-button save-component-button" onClick={() => openPackage('whole')}><Package size={14} />保存为组件</button>}
                  {current < levels.length ? <button className="next-button" aria-label="下一关" onClick={() => changeLevel(current + 1)}>下一关<ArrowRight size={16} /></button>
                    : <button className="next-button" onClick={exportSave}>导出我的作品<Download size={15} /></button>}</>
                  : <><CircleAlert size={22} /><strong>{result.error ? programming ? '检查程序与机器' : '检查电路连接' : '发现不一致'}</strong>{result.failure && <>{temporal && <p className="failure-scenario">{result.failure.scenarioLabel} · {programming ? '' : `第 ${(result.failure.stepIndex ?? 0) + 1} 步 · `}周期 {result.failure.cycle}</p>}{result.failure.program && <p className="failure-inputs">{result.failure.program.reason}<br />期望输出：{result.failure.program.expectedOutput.join(' → ')}<br />实际输出：{result.failure.program.actualOutput.join(' → ') || '尚无输出'}</p>}<p className="failure-inputs">{Object.entries(result.failure.inputs).map(([name, v]) => `${name} = ${v}`).join('，')}</p>
                    {level.outputPorts.filter(p => result.failure!.mismatches.includes(p.id)).map(p => <div key={p.id} className="failure-values"><span>{level.outputPorts.length > 1 ? `${p.label} ` : ''}期望 <b>{result.failure!.expectedOutputs[p.id]}</b></span><span>实际 <b>{result.failure!.actualOutputs[p.id]}</b></span></div>)}
                    <p>已定位到输出 {result.failure.mismatches.join('、')}。{temporal && '回放会重建失败前的完整状态。'}</p><button className="secondary-button" onClick={() => {
                      if (programming) { replayProgram(result.failure!); return; }
                      const index = temporal ? sequenceRows.findIndex(row => row.scenarioId === result.failure!.scenarioId && row.stepIndex === result.failure!.stepIndex)
                        : samples.findIndex(i => level.inputs.every(name => i[name] === result.failure!.inputs[name]));
                      if (index >= 0) observeSample(index); setFailureOnly(false);
                    }}>回放反例</button></>}{result.error && <p>{result.error}</p>}</>
                  : <><CircuitBoard size={23} /><strong>{result && !resultCurrent ? '电路已修改' : '等待验证'}</strong><p>{result && !resultCurrent ? '重新测试当前电路。' : temporal ? '完成连接后，测试连续输入、保持、复位与时钟沿。' : level.cases ? '完成连接后，运行公开测试集。' : '完成连接后，测试所有输入组合。'}</p></>}
              </div>
            </> : <div className="properties-section"><h3>所选对象</h3>{selectedNode ? <><h1>{selectedNode.label}</h1><dl><dt>类型</dt><dd>{selectedNode.type}</dd><dt>位宽</dt><dd>{selectedNode.type === 'COMPONENT' ? `${getPorts(selectedNode, workspace.library).inputs.map(p => p.bits).join(',')} → ${getPorts(selectedNode, workspace.library).outputs.map(p => p.bits).join(',')}` : selectedNode.bits ?? 1} bit</dd><dt>当前信号</dt><dd>{selectedNode.type === 'INPUT' ? inputs[selectedNode.id] : simulation.values[selectedNode.id] ?? 'X'}</dd><dt>位置</dt><dd>{Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</dd></dl>
                {!programming && selectedNode.type === 'CONST' && <label className="property-input">常量值<input aria-label="常量值" type="number" min="0" max={2 ** (selectedNode.bits ?? 1) - 1} value={selectedNode.value ?? 0} onChange={e => { const value = Math.max(0, Math.min(2 ** (selectedNode.bits ?? 1) - 1, Math.trunc(Number(e.target.value)))); commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(n => n.id === selectedNode.id ? { ...n, value } : n) }); }} /></label>}
                {!programming && selectedNode.type === 'ROM' && <button className="secondary-button" onClick={() => { setPlaying(false); setProgramId(selectedNode.id); }}>编辑 ROM 程序</button>}
                {selectedNode.type === 'COMPONENT' && workspace.library[selectedNode.componentKey!]?.deleted ? <><p className="deleted-component-note">该组件已从组件库删除，请替换或移除此残留实例。</p><button className="secondary-button" onClick={() => openReplace(selectedNode.id)}><Replace size={14} />替换组件</button></> : selectedNode.type === 'COMPONENT' && <><button className="secondary-button" onClick={() => setInspect(workspace.library[selectedNode.componentKey!])}><Eye size={14} />查看内部电路</button><button className="secondary-button" onClick={() => { try { commit(expandComponent(circuit, selectedNode.id, workspace.library)); setSelection({ nodes: [], wires: [] }); } catch (error) { notify((error as Error).message); } }}><UnfoldHorizontal size={14} />展开组件</button><button className="secondary-button" onClick={() => openReplace(selectedNode.id)}><Replace size={14} />替换组件</button></>}
                {programming || selectedNode.type === 'INPUT' || selectedNode.type === 'OUTPUT' || (selectedNode.id === 'program' && [38, 44].includes(current)) ? <p className="muted">关卡固定端口 / 程序存储器</p> : <button className="secondary-button" onClick={deleteSelected}><Trash2 size={14} />删除组件</button>}</>
                : selectedWire ? <><h1>导线</h1><dl><dt>来源</dt><dd>{circuit.nodes.find(n => n.id === selectedWire.source)?.label}.{selectedWire.sourceHandle}</dd><dt>目标</dt><dd>{circuit.nodes.find(n => n.id === selectedWire.target)?.label}.{selectedWire.targetHandle}</dd><dt>信号</dt><dd>{simulation.wires[selectedWire.id]}</dd></dl>{!programming && <button className="secondary-button" onClick={deleteSelected}><Trash2 size={14} />删除导线</button>}</>
                : <div className="empty-selection"><MousePointer2 size={26} /><p>未选择对象</p></div>}</div>}
          </div>
          <div className="task-footer"><span>数字逻辑</span><span>{temporal ? '时序电路 · 统一时钟' : '组合电路'}</span></div>
        </aside>
      </div>
    </main>
    {(chapterOpen || taskOpen) && <button className="drawer-backdrop" aria-label="关闭侧栏" onClick={() => { setChapterOpen(false); setTaskOpen(false); }} />}
    {workshopOpen && <WorkshopView
      draft={workshopEditing
        ? { levelId: 0, revision: 0, nodes: clone(workshopEditing.graph.nodes), wires: clone(workshopEditing.graph.wires) }
        : workspace.workshop ?? createWorkshopCircuit()}
      library={workspace.library}
      teachingLibrary={teachingLibrary}
      unlocked={unlocked}
      editing={workshopEditing}
      onClose={() => setWorkshopOpen(false)}
      onDraft={handleWorkshopDraft}
      onLibrary={handleWorkshopLibrary}
      notify={notify} />}
    {toast && <div className="toast" role="status"><CircleAlert size={16} /><span>{toast}</span><button aria-label="关闭通知" onClick={() => setToast('')}><X size={14} /></button></div>}
    {packageMode && <div className="modal-backdrop" onClick={() => setPackageMode(null)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="package-title" onClick={e => e.stopPropagation()}><Package size={24} /><h2 id="package-title">{packageMode === 'whole' ? '保存电路为组件' : '封装所选组件'}</h2><label className="property-input">组件名称<input autoFocus aria-label="组件名称" maxLength={60} value={componentName} onChange={e => setComponentName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveComponent(); if (e.key === 'Escape') setPackageMode(null); }} /></label><div><button className="secondary-button" onClick={() => setPackageMode(null)}>取消</button><button className="test-button" onClick={saveComponent}>保存组件</button></div></section></div>}
    {renameTarget && <div className="modal-backdrop" onClick={() => setRenameTarget(null)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-component-title" onClick={e => e.stopPropagation()}><Pencil size={24} /><h2 id="rename-component-title">重命名组件</h2><label className="property-input">组件名称<input autoFocus aria-label="新的组件名称" maxLength={60} value={renameName} onChange={e => setRenameName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyRename(); if (e.key === 'Escape') setRenameTarget(null); }} /></label><p>关卡和其他组件中使用的此版本会同时更新名称。</p><div><button className="secondary-button" onClick={() => setRenameTarget(null)}>取消</button><button className="test-button" onClick={applyRename}>确认重命名</button></div></section></div>}
    {deleteTarget && <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}><section className="reset-dialog delete-component-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-component-title" onClick={e => e.stopPropagation()}><Trash2 size={24} /><h2 id="delete-component-title">删除组件？</h2><p>将删除以下组件版本：</p><ul>{deleteKeys.map(key => <li key={key}>{workspace.library[key].name} <small>v{workspace.library[key].version}</small></li>)}</ul>{deleteKeys.length > 1 && <p>其中 {deleteKeys.length - 1} 个组件依赖当前组件，因此会一并删除。</p>}<p>关卡中已放置的实例和连线会保留并标红，直到你手动移除。</p><div><button autoFocus className="secondary-button" onClick={() => setDeleteTarget(null)}>取消</button><button className="danger-button" onClick={applyDelete}>确认删除</button></div></section></div>}
    {replaceTarget && <div className="modal-backdrop" onClick={() => setReplaceTarget(null)}><section className="replace-component-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-component-title" onClick={e => e.stopPropagation()}><header><div><Replace size={20} /><h2 id="replace-component-title">替换组件</h2></div><ToolButton label="关闭替换组件" onClick={() => setReplaceTarget(null)}><X size={18} /></ToolButton></header><p>选择接口相同的组件。原实例的位置和连线将保持不变。</p><div className="replacement-list">{replacementCandidates.map(([key, definition]) => <button key={key} className={replacementKey === key ? 'chosen' : ''} onClick={() => setReplacementKey(key)}><Package size={20} /><span><strong>{definition.name}</strong><small>v{definition.version} · {definition.inputs.length} 输入 / {definition.outputs.length} 输出</small></span>{replacementKey === key && <Check size={16} />}</button>)}{!replacementCandidates.length && <div className="replacement-empty">没有接口兼容的可用组件</div>}</div><footer><button className="secondary-button" onClick={() => setReplaceTarget(null)}>取消</button><button className="test-button" disabled={!replacementKey} onClick={applyReplacement}>确认替换</button></footer></section></div>}
    {inspect && <div className="modal-backdrop" onClick={() => setInspect(null)}><section className="component-dialog" role="dialog" aria-modal="true" aria-label="组件内部电路" onClick={e => e.stopPropagation()}><header><h2>{inspect.name} <small>v{inspect.version}</small></h2><ToolButton label="关闭组件详情" onClick={() => setInspect(null)}><X size={18} /></ToolButton></header><div className="component-interfaces"><span>输入 {inspect.inputs.map(p => `${p.label}:${p.bits}`).join(' · ')}</span><span>输出 {inspect.outputs.map(p => `${p.label}:${p.bits}`).join(' · ')}</span></div>
      <div className="component-preview"><ComponentPreview definition={inspect} library={inspectionLibrary} /></div>
      <footer>{inspect.dependencies.length ? <span>依赖 {inspect.dependencies.map(key => inspectionLibrary[key]?.name ?? key).join(' · ')}</span> : <span>{inspect.graph.nodes.filter(n => n.type !== 'INPUT' && n.type !== 'OUTPUT').length} 个元件</span>}</footer></section></div>}
    {instructionSpecOpen && <div className="modal-backdrop" onClick={() => setInstructionSpecOpen(false)}><section className="instruction-dialog" role="dialog" aria-modal="true" aria-labelledby="instruction-spec-title" onClick={e => e.stopPropagation()}>
      <header><h2 id="instruction-spec-title">指令规范</h2><ToolButton label="关闭指令规范" onClick={() => setInstructionSpecOpen(false)}><X size={18} /></ToolButton></header>
      <div className="instruction-dialog-body"><p>每条指令为 16 bit：<strong>Opcode[15:12]</strong> · <strong>Param[11:8]</strong> · <strong>Imm[7:0]</strong>。除 MOVI 外，Param 必须为 0；NOP、ADD、SUB、OUT、HLT 的 Imm 也必须为 0。未满足约束的编码为非法指令。</p>
        <table><thead><tr><th>Opcode</th><th>Name</th><th>Param</th><th>Imm</th><th>Effect</th></tr></thead><tbody>{instructionSet.map(instruction => <tr key={instruction.opcode}><td>{instruction.opcode}</td><td><strong>{instruction.name}</strong></td><td>{instruction.param}</td><td>{instruction.immediate}</td><td>{instruction.effect}</td></tr>)}</tbody></table>
        <p className="instruction-spec-note">Z 是零标志：最近一次写入 A 的结果为 0 时为 1，否则为 0；不写入 A 的指令不会更新它。控制器只在 Phase=2 执行有效指令；JZ 还要求 Z=1。ROM 编辑器中的指令字使用四位十六进制表示。</p>
      </div>
    </section></div>}
    {programId && circuit.nodes.find(n => n.id === programId && n.type === 'ROM') && <ProgramEditor key={`${current}:${programId}`} node={circuit.nodes.find(n => n.id === programId)!} activeProgram={programId === 'program' ? simulation.activeProgram : undefined} pc={simulation.values.PC} onClose={() => setProgramId(null)} onSave={words => { commit({ ...circuit, revision: circuit.revision + 1, nodes: circuit.nodes.map(n => { if (n.id !== programId) return n; const { programSource: _source, ...node } = n; return { ...node, words }; }) }); setProgramId(null); notify('ROM 程序已应用，运行状态已清零。'); }} />}
    {resetOpen && <div className="modal-backdrop" onClick={() => setResetOpen(false)}><section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={e => e.stopPropagation()}>
      <RotateCcw size={24} /><h2 id="reset-title">{programming ? '清空当前程序？' : '重置当前电路？'}</h2><p>{programming ? '清空汇编和ROM，保留CPU及通关进度。此操作可撤销。' : '移除本关的逻辑门与导线。章节进度保留，重置后可以撤销。'}</p><div><button autoFocus className="secondary-button" onClick={() => setResetOpen(false)}>取消</button><button className="danger-button" aria-label="确认重置" onClick={() => { const next = createCircuit(current); next.revision = circuit.revision + 1; commit(next); setResetOpen(false); }}>确认重置</button></div>
    </section></div>}
  </div>;
}

export default function App() { return <ReactFlowProvider><Workshop /></ReactFlowProvider>; }
