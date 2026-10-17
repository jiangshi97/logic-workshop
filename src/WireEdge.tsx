// 导线渲染：按信号值着色（绿=1、灰=0、橙=X），失败反例相关导线标红；总线线宽更粗。
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps, type Edge } from '@xyflow/react';
import type { Signal } from './simulator';

export type FlowEdge = Edge<{ value: Signal; failed: boolean; bits?: number }, 'wire'>;
export function WireEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 7, offset: 28 });
  const v = data?.value ?? 'X';
  const color = data?.failed ? '#ce4b47' : typeof v === 'string' ? '#c08a34' : v > 0 ? '#18846f' : '#86939e';
  return <>
    <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: selected ? 4 : (data?.bits ?? 1) > 1 ? 3.5 : 2.4 }} interactionWidth={22} />
    <EdgeLabelRenderer><span className={`wire-value ${selected ? 'chosen' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, color }}>
      {v}
    </span></EdgeLabelRenderer>
  </>;
}
