// Shared design-system classes — dark theme inspired by NethSecurity 8.

export const pageTitle = 'text-xl font-semibold text-slate-100';
export const sectionTitle = 'text-base font-semibold text-slate-100';
export const pageSub = 'text-sm text-slate-400';

export const card = 'bg-slate-800/60 border border-slate-700/60 rounded-xl shadow-sm';
export const cardPad = `${card} p-4`;

export const labelCls = 'block text-sm text-slate-400 mb-1';
export const hintText = 'text-xs text-slate-500 mt-1';

export const inputCls =
  'w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 ' +
  'focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 disabled:opacity-50';
export const selectCls = inputCls;
export const inputSmCls =
  'px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 ' +
  'focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30';
export const checkboxCls = 'h-4 w-4 rounded accent-indigo-500';

export const btnPrimary =
  'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2';
export const btnPrimarySm =
  'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';
export const btnSecondary =
  'px-4 py-2 rounded-lg bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 transition-colors disabled:opacity-50';
export const btnSecondarySm =
  'px-3 py-1.5 rounded-lg bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 text-sm transition-colors disabled:opacity-50';
export const btnSuccess =
  'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2';
export const btnSuccessSm =
  'px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';
export const btnDanger =
  'px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-medium transition-colors disabled:opacity-50';
export const btnDangerSm =
  'px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-sm font-medium transition-colors disabled:opacity-50';
export const btnWarningSm =
  'px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-1.5';

export const linkEdit = 'text-indigo-400 hover:text-indigo-300 text-sm transition-colors';
export const linkDelete = 'text-rose-400 hover:text-rose-300 text-sm transition-colors disabled:opacity-50';
export const linkEnable = 'text-emerald-400 hover:text-emerald-300 text-sm transition-colors disabled:opacity-50';
export const linkDisable = 'text-amber-400 hover:text-amber-300 text-sm transition-colors disabled:opacity-50';
export const linkPlain = 'text-slate-300 hover:text-white text-sm transition-colors disabled:opacity-50';

export const tableWrap = 'overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-800/40';
export const tableCls = 'w-full text-left';
export const theadCls = 'bg-slate-800/80';
export const thCls = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400';
export const thSmCls = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400';
export const tbodyCls = 'divide-y divide-slate-700/50';
export const trHover = 'hover:bg-slate-800/40 transition-colors';

const badgeBase = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset';
export const badgeGreen = `${badgeBase} bg-emerald-500/10 text-emerald-300 ring-emerald-500/30`;
export const badgeRed = `${badgeBase} bg-rose-500/10 text-rose-300 ring-rose-500/30`;
export const badgeAmber = `${badgeBase} bg-amber-500/10 text-amber-300 ring-amber-500/30`;
export const badgeSlate = `${badgeBase} bg-slate-500/10 text-slate-300 ring-slate-500/30`;
export const badgeIndigo = `${badgeBase} bg-indigo-500/10 text-indigo-300 ring-indigo-500/30`;

// Tiny inline tags (10px) used for flags like LOG / OFF / MASQUERADE / TLS.
const tagBase = 'px-1.5 py-0.5 rounded-full text-[10px] font-medium ring-1 ring-inset';
export const TAG: Record<string, string> = {
  emerald: `${tagBase} bg-emerald-500/10 text-emerald-300 ring-emerald-500/25`,
  green: `${tagBase} bg-emerald-500/10 text-emerald-300 ring-emerald-500/25`,
  red: `${tagBase} bg-rose-500/10 text-rose-300 ring-rose-500/25`,
  amber: `${tagBase} bg-amber-500/10 text-amber-300 ring-amber-500/25`,
  yellow: `${tagBase} bg-amber-500/10 text-amber-300 ring-amber-500/25`,
  slate: `${tagBase} bg-slate-500/10 text-slate-300 ring-slate-500/25`,
  indigo: `${tagBase} bg-indigo-500/10 text-indigo-300 ring-indigo-500/25`,
  violet: `${tagBase} bg-violet-500/10 text-violet-300 ring-violet-500/25`,
  purple: `${tagBase} bg-purple-500/10 text-purple-300 ring-purple-500/25`,
  sky: `${tagBase} bg-sky-500/10 text-sky-300 ring-sky-500/25`,
  cyan: `${tagBase} bg-cyan-500/10 text-cyan-300 ring-cyan-500/25`,
  teal: `${tagBase} bg-teal-500/10 text-teal-300 ring-teal-500/25`,
  orange: `${tagBase} bg-orange-500/10 text-orange-300 ring-orange-500/25`,
};

export const alertErr = 'mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200';
export const alertOk = 'mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-200';
export const alertInfo = 'mb-4 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-sm text-indigo-200';
export const alertWarn = 'mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200';

export const modalOverlay = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
export const modalCard = 'bg-slate-800 rounded-xl p-6 w-full max-w-lg border border-slate-700/60 shadow-2xl';
export const modalTitle = 'text-lg font-semibold text-slate-100 mb-4';

export const hintBox = 'mt-6 p-4 bg-slate-800/60 rounded-xl border border-slate-700/60 text-sm text-slate-300';
export const emptyBox = 'p-6 border border-dashed border-slate-600/70 rounded-xl text-center text-slate-400 text-sm';
export const filterBar = 'flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60';

export const loadingRow = 'flex items-center gap-2 text-slate-400';
export const spinner = 'animate-spin h-5 w-5';
export const spinnerSm = 'animate-spin h-4 w-4';
