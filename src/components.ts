// 玩家组件系统：整图保存（packageCircuit）、框选封装（encapsulateSelection）与实例展开（expandComponent）。
// 所有操作先构造结果再整体校验，失败抛错回滚；define 保证同名保存自动升级版本、旧实例引用不受影响。
import type { Circuit, CircuitGraph, CircuitNode, ComponentDefinition, ComponentLibrary, Port, Wire } from './contracts';
import { getPorts, validateCircuit, validateLibrary, validateWorkshopCircuit } from './model';
import { createId } from './id';
export { validateLibrary } from './model';

/** 校验入口按电路归属分派：工坊草稿（levelId=0）走不绑定关卡的校验。 */
const validateOwned = (circuit: Circuit, library: ComponentLibrary, workshop: boolean): string[] =>
  (workshop ? validateWorkshopCircuit(circuit, library) : validateCircuit(circuit, library));

/** 由内部图与接口生成新的组件版本；同名组件 version+1，依赖清单由图内 COMPONENT 引用推导。 */
function define(graph:CircuitGraph, inputs:Port[],outputs:Port[],name:string,library:ComponentLibrary,sourceLevel?:number) {
  name=name.trim();
  if (!name||name.length>60) throw new Error('组件名称需要 1 至 60 个字符。');
  const previous=Object.values(library).filter(d=>d.name===name).sort((a,b)=>b.version-a.version)[0];
  const definition:ComponentDefinition={id:previous?.id??createId('component'),version:(previous?.version??0)+1,name,
    inputs:structuredClone(inputs),outputs:structuredClone(outputs),graph:structuredClone(graph),
    dependencies:[...new Set(graph.nodes.filter(n=>n.type==='COMPONENT').map(n=>n.componentKey!))].sort(),sourceLevel};
  const key=`${definition.id}@${definition.version}`;
  const next={...library,[key]:definition};
  const error=validateLibrary(next)[0];if(error)throw new Error(error);
  return {definition,key,library:next};
}

/** 把整关电路（或工坊草稿）保存为组件，接口即其 INPUT/OUTPUT；工坊组件不带 sourceLevel。 */
export function packageCircuit(circuit:Circuit,name:string,library:ComponentLibrary={},workshop=false) {
  const error=validateOwned(circuit,library,workshop)[0];if(error)throw new Error(error);
  const interfacePorts=(type:'INPUT'|'OUTPUT')=>circuit.nodes.filter(n=>n.type===type).map(n=>({id:n.id,label:n.label,bits:n.bits??1}));
  return define({nodes:circuit.nodes,wires:circuit.wires},interfacePorts('INPUT'),interfacePorts('OUTPUT'),name,library,workshop?undefined:circuit.levelId);
}

/** 框选封装：跨界导线收集为接口端口，选区在原图中被一个 COMPONENT 实例替换，外接连线原样转接。 */
export function encapsulateSelection(circuit:Circuit,nodeIds:string[],name:string,library:ComponentLibrary={},workshop=false) {
  const error=validateOwned(circuit,library,workshop)[0];if(error)throw new Error(error);
  const selected=circuit.nodes.filter(n=>nodeIds.includes(n.id));
  if (!selected.length||selected.some(n=>n.type==='INPUT'||n.type==='OUTPUT')) throw new Error('请选择需要封装的逻辑组件。');
  const chosen=new Set(selected.map(n=>n.id)), nodes=new Map(circuit.nodes.map(n=>[n.id,n]));
  const incoming=circuit.wires.filter(w=>!chosen.has(w.source)&&chosen.has(w.target));
  const outgoing=circuit.wires.filter(w=>chosen.has(w.source)&&!chosen.has(w.target));
  if (!outgoing.length) throw new Error('所选电路需要至少一个连接到外部的输出。');
  const inputMap=new Map<string,Port>(),outputMap=new Map<string,Port>();
  const occupied=new Set(selected.map(n=>n.id));
  function interfaceId(prefix:string,index:number) { let id=`${prefix}${index}`;while(occupied.has(id))id=`_${id}`;occupied.add(id);return id; }
  for (const w of incoming) {
    const key=`${w.source}:${w.sourceHandle}`;
    if (!inputMap.has(key)) {
      const source=nodes.get(w.source)!,port=getPorts(source,library).outputs.find(p=>p.id===w.sourceHandle)!;
      inputMap.set(key,{id:interfaceId('in',inputMap.size),label:`${source.label}.${port.label}`,bits:port.bits});
    }
  }
  for (const w of outgoing) {
    const key=`${w.source}:${w.sourceHandle}`;
    if (!outputMap.has(key)) {
      const source=nodes.get(w.source)!,port=getPorts(source,library).outputs.find(p=>p.id===w.sourceHandle)!;
      outputMap.set(key,{id:interfaceId('out',outputMap.size),label:`${source.label}.${port.label}`,bits:port.bits});
    }
  }
  const inputs=[...inputMap.values()],outputs=[...outputMap.values()];
  const left=Math.min(...selected.map(n=>n.position.x))-220;
  const right=Math.max(...selected.map(n=>n.position.x+(n.type==='COMPONENT'||n.type==='DFF'?180:130)))+220;
  const top=Math.min(...selected.map(n=>n.position.y));
  const interfaceNodes:CircuitNode[]=[...inputs.map((p,i)=>({id:p.id,type:'INPUT' as const,label:p.label,bits:p.bits,position:{x:left,y:top+i*150}})),
    ...outputs.map((p,i)=>({id:p.id,type:'OUTPUT' as const,label:p.label,bits:p.bits,position:{x:right,y:top+i*150}}))];
  const graph:CircuitGraph={nodes:[...selected,...interfaceNodes],wires:[...circuit.wires.filter(w=>chosen.has(w.source)&&chosen.has(w.target)),
    ...incoming.map(w=>({...w,id:createId('w'),source:inputMap.get(`${w.source}:${w.sourceHandle}`)!.id,sourceHandle:'out'})),
    ...[...outputMap.entries()].map(([key,p])=>{const w=outgoing.find(w=>`${w.source}:${w.sourceHandle}`===key)!;return{id:createId('w'),source:w.source,sourceHandle:w.sourceHandle,target:p.id,targetHandle:'in'};})]};
  const packaged=define(graph,inputs,outputs,name,library,workshop?undefined:circuit.levelId);
  const id=createId('c');
  const replacement:CircuitNode={id,type:'COMPONENT',label:packaged.definition.name,componentKey:packaged.key,
    position:{x:selected.reduce((s,n)=>s+n.position.x,0)/selected.length,y:selected.reduce((s,n)=>s+n.position.y,0)/selected.length}};
  const next:Circuit={...circuit,revision:circuit.revision+1,nodes:[...circuit.nodes.filter(n=>!chosen.has(n.id)),replacement],wires:[
    ...circuit.wires.filter(w=>!chosen.has(w.source)&&!chosen.has(w.target)),
    ...[...inputMap.entries()].map(([key,p])=>{const w=incoming.find(w=>`${w.source}:${w.sourceHandle}`===key)!;return{...w,target:id,targetHandle:p.id};}),
    ...outgoing.map(w=>({...w,source:id,sourceHandle:outputMap.get(`${w.source}:${w.sourceHandle}`)!.id})),
  ]};
  const nextError=validateOwned(next,packaged.library,workshop)[0];if(nextError)throw new Error(nextError);
  return {...packaged,circuit:next};
}

/** 内联展开一个组件实例：内部节点落入当前图，临时接口节点按「进入×离开」拼接后删除。 */
export function expandComponent(circuit:Circuit,instanceId:string,library:ComponentLibrary,workshop=false):Circuit {
  const error=validateOwned(circuit,library,workshop)[0];if(error)throw new Error(error);
  const instance=circuit.nodes.find(n=>n.id===instanceId);
  if (!instance||instance.type!=='COMPONENT') throw new Error('请选择一个已封装组件。');
  const def=library[instance.componentKey!]!;
  const internal=def.graph.nodes.filter(n=>n.type!=='INPUT'&&n.type!=='OUTPUT');
  const ids=new Map(internal.map(n=>[n.id,createId('expanded')]));
  const minX=Math.min(0,...internal.map(n=>n.position.x)),minY=Math.min(0,...internal.map(n=>n.position.y));
  const expanded=internal.map(n=>({...structuredClone(n),id:ids.get(n.id)!,position:{x:instance.position.x+n.position.x-minX,y:instance.position.y+n.position.y-minY}}));
  const interfaces=def.graph.nodes.filter(n=>n.type==='INPUT'||n.type==='OUTPUT');
  for (const boundary of interfaces) ids.set(boundary.id,createId('interface'));
  // Retain temporary interface vertices while substituting both ends of external wires.
  // In particular, a component output feeding its own input now joins two boundaries,
  // rather than retaining an endpoint on the component that is about to disappear.
  let wires:Wire[]=[...circuit.wires.map(w=>({ ...w,
    ...(w.source===instanceId?{source:ids.get(w.sourceHandle)!,sourceHandle:'out'}:{}),
    ...(w.target===instanceId?{target:ids.get(w.targetHandle)!,targetHandle:'in'}:{}),
  })),...def.graph.wires.map(w=>({...w,id:createId('w'),source:ids.get(w.source)!,target:ids.get(w.target)!}))];
  // Splice each single-port boundary through its actual driver and fanout. If it has
  // no driver, its outgoing wires vanish and the internal targets remain X.
  for (const boundary of interfaces) {
    const id=ids.get(boundary.id)!,incoming=wires.filter(w=>w.target===id),outgoing=wires.filter(w=>w.source===id);
    wires=wires.filter(w=>w.source!==id&&w.target!==id);
    for (const from of incoming) for (const to of outgoing) wires.push({id:createId('w'),
      source:from.source,sourceHandle:from.sourceHandle,target:to.target,targetHandle:to.targetHandle});
  }
  const next={...circuit,revision:circuit.revision+1,nodes:[...circuit.nodes.filter(n=>n.id!==instanceId),...expanded],wires};
  const nextError=validateOwned(next,library,workshop)[0];if(nextError)throw new Error(nextError);return next;
}
