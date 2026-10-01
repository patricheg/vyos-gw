import { useCallback, useEffect, useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { getMetricsCurrent, getMetricsHistory } from '../api/client';
import type { MetricsCurrent, MetricsHistory } from '../types';
import UplotChart from '../components/UplotChart';
import { pageTitle, pageSub, cardPad, sectionTitle, selectCls, emptyBox, tableWrap, tableCls, theadCls, thSmCls, tbodyCls } from '../ui';

const RANGES = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
];

const fmtBits = (v: number | null | undefined) => {
  if (v == null) return '—';
  const b = v * 8;
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' Gbps';
  if (b >= 1e6) return (b / 1e6).toFixed(2) + ' Mbps';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' Kbps';
  return b.toFixed(0) + ' bps';
};

const fmtBytes = (v: number | null | undefined) => {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GB/s';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' MB/s';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + ' KB/s';
  return v.toFixed(0) + ' B/s';
};

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1) + ' %');
const fmtMb = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1024 ? (v / 1024).toFixed(2) + ' GB' : v.toFixed(0) + ' MB';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={cardPad}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cardPad}>
      <div className={`${sectionTitle} mb-3`}>{title}</div>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const [current, setCurrent] = useState<MetricsCurrent | null>(null);
  const [history, setHistory] = useState<MetricsHistory | null>(null);
  const [range, setRange] = useState(60);
  const [iface, setIface] = useState('');

  useEffect(() => {
    const tick = () => getMetricsCurrent().then(setCurrent).catch(() => {});
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const loadHistory = useCallback(() => {
    getMetricsHistory(range).then(setHistory).catch(() => {});
  }, [range]);

  useEffect(() => {
    loadHistory();
    const id = setInterval(loadHistory, 5000);
    return () => clearInterval(id);
  }, [loadHistory]);

  const ifaceNames = useMemo(() => {
    const names = new Set<string>();
    if (current) Object.keys(current.interfaces).forEach(n => names.add(n));
    if (history) Object.keys(history.interfaces).forEach(n => names.add(n));
    return Array.from(names).sort();
  }, [current, history]);

  useEffect(() => {
    if (!iface && ifaceNames.length) setIface(ifaceNames[0]);
  }, [ifaceNames, iface]);

  const empty = history !== null && history.ts.length === 0;

  const throughputData = useMemo((): uPlot.AlignedData => {
    const s = history?.interfaces[iface];
    if (!s) return [[], [], []] as uPlot.AlignedData;
    return [
      s.ts,
      s.rx_bps.map(v => (v == null ? null : v * 8)),
      s.tx_bps.map(v => (v == null ? null : v * 8)),
    ] as uPlot.AlignedData;
  }, [history, iface]);

  const cpuData = useMemo((): uPlot.AlignedData => {
    if (!history) return [[], []] as uPlot.AlignedData;
    return [history.ts, history.system.cpu_pct] as uPlot.AlignedData;
  }, [history]);

  const memData = useMemo((): uPlot.AlignedData => {
    if (!history) return [[], []] as uPlot.AlignedData;
    return [history.ts, history.system.mem_used_mb] as uPlot.AlignedData;
  }, [history]);

  const diskIoData = useMemo((): uPlot.AlignedData => {
    if (!history) return [[], [], []] as uPlot.AlignedData;
    return [history.ts, history.system.disk_read_bps, history.system.disk_write_bps] as uPlot.AlignedData;
  }, [history]);

  const diskUseData = useMemo((): uPlot.AlignedData => {
    if (!history) return [[], []] as uPlot.AlignedData;
    return [history.ts, history.system.disk_used_pct] as uPlot.AlignedData;
  }, [history]);

  const sys = current?.system;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className={pageTitle}>Dashboard</h1>
          <p className={pageSub}>Live host metrics — interfaces, CPU, memory and disk</p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.minutes}
              onClick={() => setRange(r.minutes)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r.minutes
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="CPU"
          value={fmtPct(sys?.cpu_pct)}
          sub={sys?.load1 != null ? `load ${sys.load1.toFixed(2)}` : undefined}
        />
        <StatCard
          label="Memory"
          value={
            sys?.mem_used_mb != null && sys?.mem_total_mb
              ? fmtPct((sys.mem_used_mb / sys.mem_total_mb) * 100)
              : '—'
          }
          sub={
            sys?.mem_used_mb != null && sys?.mem_total_mb != null
              ? `${fmtMb(sys.mem_used_mb)} / ${fmtMb(sys.mem_total_mb)}`
              : undefined
          }
        />
        <StatCard
          label="Disk usage"
          value={fmtPct(sys?.disk_used_pct)}
          sub={sys?.disk_total_mb != null ? `of ${fmtMb(sys.disk_total_mb)}` : undefined}
        />
        <StatCard
          label="Disk I/O"
          value={fmtBytes(sys?.disk_read_bps)}
          sub={`write ${fmtBytes(sys?.disk_write_bps)}`}
        />
      </div>

      {current && Object.keys(current.interfaces).length > 0 && (
        <div className={`${tableWrap} mb-6`}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={thSmCls}>Interface</th>
                <th className={thSmCls}>RX rate</th>
                <th className={thSmCls}>TX rate</th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {Object.entries(current.interfaces).map(([name, c]) => (
                <tr key={name} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-sm text-slate-200 font-medium">{name}</td>
                  <td className="px-3 py-2 text-sm text-emerald-300 font-mono">{fmtBits(c.rx_bps)}</td>
                  <td className="px-3 py-2 text-sm text-sky-300 font-mono">{fmtBits(c.tx_bps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {empty && (
        <div className={emptyBox}>
          No metrics yet. The collector runs only on-device (Linux /proc) and
          needs a few seconds to accumulate samples.
        </div>
      )}

      {!empty && history && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard title="Interface throughput">
            <div className="mb-3 max-w-xs">
              <select className={selectCls} value={iface} onChange={e => setIface(e.target.value)}>
                {ifaceNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <UplotChart
              data={throughputData}
              series={[
                { label: 'RX', color: '#34d399' },
                { label: 'TX', color: '#38bdf8' },
              ]}
              yFormat={v => fmtBits(v)}
            />
          </ChartCard>

          <ChartCard title="CPU usage">
            <UplotChart
              data={cpuData}
              series={[{ label: 'CPU %', color: '#818cf8' }]}
              yFormat={v => v.toFixed(0) + ' %'}
            />
          </ChartCard>

          <ChartCard title="Memory used">
            <UplotChart
              data={memData}
              series={[{ label: 'Used', color: '#f472b6' }]}
              yFormat={v => fmtMb(v)}
            />
          </ChartCard>

          <ChartCard title="Disk I/O">
            <UplotChart
              data={diskIoData}
              series={[
                { label: 'Read', color: '#fbbf24' },
                { label: 'Write', color: '#fb7185' },
              ]}
              yFormat={v => fmtBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Disk usage">
            <UplotChart
              data={diskUseData}
              series={[{ label: 'Used %', color: '#2dd4bf' }]}
              yFormat={v => v.toFixed(0) + ' %'}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
