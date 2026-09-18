import { FormEvent, useState } from 'react';
import { login, setupPassword } from '../api/client';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <form onSubmit={submit} className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl p-8 shadow-lg">
        <h1 className="text-xl font-bold text-white mb-1">VyOS Web Gateway</h1>
        <p className="text-sm text-gray-400 mb-6">
          {isSetup
            ? 'First run — create the local administrator password for this console.'
            : 'Sign in to the management console.'}
        </p>

        <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          className="w-full mb-4 px-3 py-2 rounded bg-gray-900 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
        />

        <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          autoFocus
          className="w-full mb-4 px-3 py-2 rounded bg-gray-900 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
        />

        {isSetup && (
          <>
            <label className="block text-xs font-medium text-gray-400 mb-1">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full mb-4 px-3 py-2 rounded bg-gray-900 border border-gray-600 text-white focus:border-blue-500 focus:outline-none"
            />
          </>
        )}

        {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50"
        >
          {busy ? 'Please wait…' : isSetup ? 'Create password' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
