// 组件内部电路的只读预览：用 ELK 分层布局（从左到右、正交布线）重排节点，
// 布局失败时回退到保存时的原始坐标；signals 可选注入实时仿真值。
import { useEffect, useMemo, useState } from 'react';
import { BaseEdge, Background, EdgeLabelRenderer, getSmoothStepPath, ReactFlow, ReactFlowProvider, type Edge, type EdgeProps } from '@xyflow/react';
import type { ElkEdgeSection, ElkNode, ElkPoint } from 'elkjs/lib/elk-api';
import type { CircuitGraph, ComponentDefinition, ComponentLibrary, Signal } from './contracts';
import { getPorts } from './model';
import { CircuitNodeView, nodeDimensions, portTop, type FlowNode } from './CircuitNode';

const nodeTypes = { circuit: CircuitNodeView };
const edgeTypes = { 'preview-wire': PreviewWireEdge };

type PreviewEdgeData = { value: Signal; failed: false; bits?: number; route?: ElkPoint[] };
type PreviewEdge = Edge<PreviewEdgeData, 'preview-wire'>;

export interface PreviewSignals {
  values: Record<string, Signal>;
  portValues: Record<string, Signal>;
  wires: Record<string, Signal>;
}

function routePoints(sections: ElkEdgeSection[] | undefined) {
  if (!sections?.length) return undefined;
  const points: ElkPoint[] = [];
  for (const section of sections) {
    const sectionPoints = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    for (const point of sectionPoints) {
      const previous = points[points.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) points.push(point);
    }
  }
  return points.length > 1 ? points : undefined;
}

function polylinePath(points: ElkPoint[]) {
  return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}`;
}

function polylineMidpoint(points: ElkPoint[]) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const target = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1];
    if (travelled + length >= target) {
      const ratio = length ? (target - travelled) / length : 0;
      return { x: points[index - 1].x + (points[index].x - points[index - 1].x) * ratio,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * ratio };
    }
    travelled += length;
  }
  return points[Math.floor(points.length / 2)];
}

function PreviewWireEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<PreviewEdge>) {
  const fallback = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0, offset: 28 });
  const points = data?.route;
  const path = points ? polylinePath(points) : fallback[0];
  const midpoint = points ? polylineMidpoint(points) : { x: fallback[1], y: fallback[2] };
  const color = data?.failed ? '#ce4b47' : '#c08a34';
  return <>
    <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? 4 : (data?.bits ?? 1) > 1 ? 3.5 : 2.4 }} interactionWidth={22} />
    <EdgeLabelRenderer><span className={`wire-value ${selected ? 'chosen' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px)`, color }}>{data?.value ?? 'X'}</span></EdgeLabelRenderer>
  </>;
}

function flowGraph(definition: ComponentDefinition, library: ComponentLibrary,
  positions = new Map<string, { x: number; y: number }>(), routes = new Map<string, ElkPoint[]>()) {
  const nodes: FlowNode[] = definition.graph.nodes.map(node => {
    const ports = getPorts(node, library);
    return { id: node.id, type: 'circuit', position: positions.get(node.id) ?? node.position,
      measured: nodeDimensions(node.type, ports), data: { kind: node.type, label: node.label, bits: node.bits ?? 1,
        ports, value: 'X', inputValues: {}, portValues: {}, pending: null, failed: false, readOnly: true,
        onToggle: () => {}, onValue: () => {}, onPort: () => {} } };
  });
  const edges: PreviewEdge[] = definition.graph.wires.map(wire => ({ ...wire, type: 'preview-wire', data: { value: 'X', failed: false,
    route: routes.get(wire.id),
    bits: getPorts(definition.graph.nodes.find(node => node.id === wire.source)!, library).outputs.find(port => port.id === wire.sourceHandle)?.bits } }));
  return { nodes, edges };
}

function applySignals(graph: { nodes: FlowNode[]; edges: PreviewEdge[] }, definition: ComponentDefinition,
  library: ComponentLibrary, signals?: PreviewSignals) {
  if (!signals) return graph;
  const inputValues = new Map<string, Record<string, Signal>>();
  for (const wire of definition.graph.wires) {
    const values = inputValues.get(wire.target) ?? {};
    values[wire.targetHandle] = signals.wires[wire.id] ?? 'X';
    inputValues.set(wire.target, values);
  }
  const nodes = graph.nodes.map(node => {
    const source = definition.graph.nodes.find(candidate => candidate.id === node.id);
    if (!source) return node;
    const ports = getPorts(source, library);
    return { ...node, data: { ...node.data,
      value: signals.values[node.id] ?? 'X',
      inputValues: inputValues.get(node.id) ?? {},
      portValues: Object.fromEntries(ports.outputs.map(port => [port.id, signals.portValues[`${node.id}:${port.id}`] ?? (source.type === 'INPUT' ? signals.values[node.id] ?? 'X' : 'X')])),
    } };
  });
  const edges = graph.edges.map(edge => ({ ...edge, data: { value: signals.wires[edge.id] ?? 'X', failed: false as const, bits: edge.data?.bits, route: edge.data?.route } }));
  return { nodes, edges };
}

/** 组装 ELK 布局图：端口固定在节点左右两侧（FIXED_POS），INPUT/OUTPUT 分别约束在首/末层。 */
async function layoutGraph(definition: ComponentDefinition, library: ComponentLibrary) {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const graph: ElkNode = {
    id: 'component-preview',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: definition.graph.nodes.map(node => {
      const ports = getPorts(node, library);
      const dimensions = nodeDimensions(node.type, ports);
      return { id: node.id, width: dimensions.width, height: dimensions.height,
        ports: [...ports.inputs.map((port, index) => ({ id: `${node.id}:${port.id}`, width: 1, height: 1,
          x: -0.5, y: portTop(index, ports.inputs.length) - 0.5, layoutOptions: { 'elk.port.side': 'WEST' } })),
        ...ports.outputs.map((port, index) => ({ id: `${node.id}:${port.id}`, width: 1, height: 1,
          x: dimensions.width - 0.5, y: portTop(index, ports.outputs.length) - 0.5, layoutOptions: { 'elk.port.side': 'EAST' } }))],
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS',
          ...(node.type === 'INPUT' ? { 'elk.layered.layering.layerConstraint': 'FIRST' }
            : node.type === 'OUTPUT' ? { 'elk.layered.layering.layerConstraint': 'LAST' } : {}) } };
    }),
    edges: definition.graph.wires.map(wire => ({ id: wire.id,
      sources: [`${wire.source}:${wire.sourceHandle}`], targets: [`${wire.target}:${wire.targetHandle}`] })),
  };
  const layout = await elk.layout(graph);
  const positions = new Map(layout.children?.map(node => [node.id, { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) }]));
  const routes = new Map(layout.edges?.flatMap(edge => {
    const points = routePoints(edge.sections);
    return points ? [[edge.id, points] as const] : [];
  }));
  return flowGraph(definition, library, positions, routes);
}

export function ComponentPreview({ definition, library, signals, provider = true }: { definition: ComponentDefinition; library: ComponentLibrary; signals?: PreviewSignals; provider?: boolean }) {
  const [graph, setGraph] = useState<{ nodes: FlowNode[]; edges: PreviewEdge[] } | null>(null);
  useEffect(() => {
    let current = true;
    setGraph(null);
    void layoutGraph(definition, library).then(result => { if (current) setGraph(result); })
      .catch(() => { if (current) setGraph(flowGraph(definition, library)); });
    return () => { current = false; };
  }, [definition, library]);
  if (!graph) return <div className="component-preview-loading">正在载入内部电路...</div>;
  const displayedGraph = applySignals(graph, definition, library, signals);
  const preview = <ReactFlow<FlowNode, PreviewEdge> nodes={displayedGraph.nodes} edges={displayedGraph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView minZoom={0.04}>
    <Background gap={20} />
  </ReactFlow>;
  return provider ? <ReactFlowProvider>{preview}</ReactFlowProvider> : preview;
}

export function CircuitPreview({ graph, library, signals }: { graph: CircuitGraph; library: ComponentLibrary; signals: PreviewSignals }) {
  const definition = useMemo<ComponentDefinition>(() => ({ id: 'circuit-preview', version: 1, name: '电路预览', inputs: [], outputs: [], graph, dependencies: [] }), [graph]);
  return <ComponentPreview definition={definition} library={library} signals={signals} provider={false} />;
}
