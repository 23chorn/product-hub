import { useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';

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
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">Product Hub</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to continue</p>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-4" autoComplete="off" data-1p-ignore data-lpignore="true">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
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
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
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
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
