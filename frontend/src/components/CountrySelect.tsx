import { useEffect, useRef, useState } from 'react';
import { COUNTRIES } from '../countries';
import { TAG } from '../ui';

interface Props {
  value: string[];
  onChange: (codes: string[]) => void;
  placeholder?: string;
}

export default function CountrySelect({ value, onChange, placeholder = 'Select countries…' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    : COUNTRIES;

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className="w-full min-h-[38px] px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg cursor-pointer flex flex-wrap items-center gap-1 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30"
      >
        {value.length === 0 && <span className="text-slate-500 text-sm px-1 py-0.5">{placeholder}</span>}
        {value.map(code => (
          <span key={code} className={`flex items-center gap-1 font-mono uppercase ${TAG.indigo}`}>
            {code}
            <button
              onClick={e => { e.stopPropagation(); onChange(value.filter(c => c !== code)); }}
              className="text-indigo-300 hover:text-rose-300 leading-none"
              title="Remove"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl">
          <div className="p-2 border-b border-slate-700">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or code…"
              className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No matches</div>}
            {filtered.map(c => (
              <label key={c.code} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/50 cursor-pointer text-sm">
                <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} className="accent-indigo-500" />
                <span className="font-mono text-slate-400 w-6">{c.code}</span>
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
