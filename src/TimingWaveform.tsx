// 时序波形：把最近 64 帧观察渲染成波形图——1bit 信号画跳变折线，总线画数值格；列头标出时钟沿与周期号。
import type { Port, SimulationFrame } from './contracts';

export function TimingWaveform({ frames, inputs, outputs }: { frames: SimulationFrame[]; inputs: Port[]; outputs: Port[] }) {
  if (!frames.length) return <div className="waveform-empty">改变输入或单步周期，观察信号随时间的变化。</div>;
  const rows = [...inputs.map(port => ({ ...port, direction: 'input' as const })), ...outputs.map(port => ({ ...port, direction: 'output' as const }))];
  const width = frames.length * 48;
  const value = (row: typeof rows[number], index: number) => row.direction === 'input' ? frames[index].inputs[row.id] : frames[index].outputs[row.id];
  return <div className="timing-waveform" aria-label="时序波形" data-testid="timing-waveform" data-frames={frames.length}>
    <div className="waveform-labels"><span>沿 / 周期</span>{rows.map(row => <span key={`${row.direction}-${row.id}`}><b>{row.label}</b><small>{row.bits} bit</small></span>)}</div>
    <div className="waveform-scroll"><svg width={width} height={(rows.length + 1) * 32} role="img" aria-label="信号波形，向右为时间">
      {frames.map((frame, index) => <g key={index}><line x1={index * 48} x2={index * 48} y1={28} y2={(rows.length + 1) * 32} className={frame.tick ? 'waveform-edge' : 'waveform-observation'} /><text x={index * 48 + 24} y={20} textAnchor="middle">{frame.tick ? '↑' : '·'}{frame.cycle}</text></g>)}
      {rows.map((row, rowIndex) => <g key={`${row.direction}-${row.id}`} className="waveform-signal">
        {frames.map((_frame, index) => {
          const signal = value(row, index), x = index * 48, y = (rowIndex + 1) * 32;
          if (row.bits === 1 && typeof signal === 'number') {
            const height = signal === 1 ? 7 : 24;
            const previous = index > 0 ? value(row, index - 1) : signal;
            const previousHeight = previous === 1 ? 7 : 24;
            return <path key={index} d={`M${x},${y + previousHeight} V${y + height} H${x + 48}`} className="waveform-bit" />;
          }
          return <g key={index}><rect x={x + 2} y={y + 4} width={44} height={24} rx={3} className={typeof signal === 'string' ? 'waveform-unknown' : 'waveform-bus'} /><text x={x + 24} y={y + 20} textAnchor="middle">{signal ?? 'X'}</text></g>;
        })}
      </g>)}
    </svg></div>
  </div>;
}
