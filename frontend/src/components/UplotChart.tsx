import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface SeriesDef {
  label: string;
  color: string;
}

interface Props {
  data: uPlot.AlignedData;
  series: SeriesDef[];
  height?: number;
  yFormat?: (v: number) => string;
}

export default function UplotChart({ data, series, height = 220, yFormat }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height,
      padding: [8, 8, 0, 0],
      cursor: { show: true },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: '#94a3b8',
          font: '11px ui-sans-serif, system-ui, sans-serif',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#334155', width: 1 },
        },
        {
          stroke: '#94a3b8',
          font: '11px ui-sans-serif, system-ui, sans-serif',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#334155', width: 1 },
          size: 64,
          values: (_u, splits) => splits.map(v => (yFormat ? yFormat(v) : String(v))),
        },
      ],
      series: [
        { label: 'Time' },
        ...series.map(s => ({
          label: s.label,
          stroke: s.color,
          width: 1.6,
          points: { show: false },
        })),
      ],
    };
    const u = new uPlot(opts, data, ref.current);
    chartRef.current = u;
    const ro = new ResizeObserver(() => {
      if (ref.current) u.setSize({ width: ref.current.clientWidth, height });
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      u.destroy();
      chartRef.current = null;
    };
    // Recreate only when the series set changes shape; data flows via setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.map(s => s.label).join(','), height]);

  useEffect(() => {
    chartRef.current?.setData(data);
  }, [data]);

  return <div ref={ref} className="w-full" />;
}
