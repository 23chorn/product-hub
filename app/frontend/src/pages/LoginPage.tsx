import { useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AsciiMark } from '../components/common/AsciiMark';
import { AsciiCubeBackground } from '../components/common/AsciiCubeBackground';

export function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { setUser } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      const data = await api.getMe();
      if (data.user) {
        setUser(data.user);
        onAuthenticated();
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-surface-100 dark:bg-surface-950 p-4">
      <AsciiCubeBackground className="absolute inset-0" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center opacity-0 motion-reduce:opacity-100 motion-safe:animate-fade-in">
          <AsciiMark width={150} className="mx-auto mb-4" colored />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">xCube Flow</h1>
          <p className="text-xs font-mono text-surface-500 mt-1">
            <span className="text-brand-500">&gt;</span> sign in to continue
          </p>
        </div>

        <div
          className="bg-surface-50/80 dark:bg-surface-900/80 backdrop-blur-sm border border-surface-200 dark:border-surface-700/60 rounded-xl p-6 shadow-xl opacity-0 motion-reduce:opacity-100 motion-safe:animate-fade-in"
          style={{ animationDelay: '150ms' }}
        >
          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off" data-1p-ignore data-lpignore="true">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-mono text-surface-500 dark:text-surface-400 mb-1.5">
                <span className="text-brand-500">&gt;</span> username
              </label>
              <input
                type="text"
                name="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                placeholder="your-username"
                autoFocus
                autoComplete="username"
                data-1p-ignore
                data-lpignore="true"
                spellCheck={false}
                autoCapitalize="none"
                className="w-full bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded-lg px-3 py-2 text-sm font-mono text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-mono text-surface-500 dark:text-surface-400 mb-1.5">
                <span className="text-brand-500">&gt;</span> password
              </label>
              <input
                type="password"
                name="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
                data-1p-ignore
                data-lpignore="true"
                className="w-full bg-surface-50 dark:bg-surface-800 border border-surface-300 dark:border-surface-600 rounded-lg px-3 py-2 text-sm font-mono text-surface-900 dark:text-surface-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-xs font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 disabled:text-surface-500 text-white text-sm font-mono font-medium rounded-lg transition-colors"
            >
              {loading ? 'signing in…' : 'sign in →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
