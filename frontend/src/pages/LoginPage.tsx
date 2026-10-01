import { FormEvent, useState } from 'react';
import { login, setupPassword } from '../api/client';
import { inputCls, labelCls, btnPrimary } from '../ui';

export default function LoginPage({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSetup = mode === 'setup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (isSetup) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match');
        return;
      }
    }
    setBusy(true);
    try {
      if (isSetup) {
        await setupPassword(username, password);
      } else {
        await login(username, password);
      }
      onDone();
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-800/60 border border-slate-700/60 rounded-xl p-8 shadow-sm">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-100">VyOS GW</h1>
        </div>
        <p className="text-sm text-slate-400 mb-6 mt-2">
          {isSetup
            ? 'First run — create the local administrator password for this console.'
            : 'Sign in to the management console.'}
        </p>

        <label className={labelCls}>Username</label>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          className={inputCls + ' mb-4'}
        />

        <label className={labelCls}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          autoFocus
          className={inputCls + ' mb-4'}
        />

        {isSetup && (
          <>
            <label className={labelCls}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputCls + ' mb-4'}
            />
          </>
        )}

        {error && <div className="mb-4 text-sm text-rose-400">{error}</div>}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className={btnPrimary + ' w-full'}
        >
          {busy ? 'Please wait…' : isSetup ? 'Create password' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
