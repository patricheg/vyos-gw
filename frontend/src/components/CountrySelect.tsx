import { useEffect, useRef, useState } from 'react';
import { COUNTRIES } from '../countries';

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
        className="w-full min-h-[38px] px-2 py-1 bg-gray-900 border border-gray-600 rounded cursor-pointer flex flex-wrap items-center gap-1 focus-within:border-blue-500"
      >
        {value.length === 0 && <span className="text-gray-400 text-sm px-1 py-0.5">{placeholder}</span>}
        {value.map(code => (
          <span key={code} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-700 text-gray-200 text-xs font-mono">
            {code}
            <button
              onClick={e => { e.stopPropagation(); onChange(value.filter(c => c !== code)); }}
              className="text-gray-400 hover:text-red-300 leading-none"
              title="Remove"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-gray-900 border border-gray-600 rounded shadow-xl">
          <div className="p-2 border-b border-gray-700">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or code…"
              className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-gray-500">No matches</div>}
            {filtered.map(c => (
              <label key={c.code} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-700/60 cursor-pointer text-sm">
                <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)} />
                <span className="font-mono text-gray-400 w-6">{c.code}</span>
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
