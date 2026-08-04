import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useAuth } from '../context/AuthContext';

/**
 * Slice 9.1 — Authentication. A plain controlled form (not react-hook-form —
 * two fields with no cross-field rules don't need it, same reasoning as the
 * rename dialog in SimulationHistory.tsx) that calls `AuthContext.login()`
 * and redirects into the app on success. Reachable at any time regardless of
 * whether `REQUIRE_AUTH` is actually on — see AuthContext's doc comment for
 * why there's no proactive route guard steering people here.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loggingIn, loginError } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const success = await login(username, password);
    if (success) {
      navigate('/');
    }
  };

  return (
    <div className="flex justify-center py-24">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-brand-bg p-8"
      >
        <h1 className="text-center text-2xl font-semibold text-slate-800">Log In</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="login-username" className="text-sm font-bold text-slate-800">
            Username
          </label>
          <InputText
            id="login-username"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="login-password" className="text-sm font-bold text-slate-800">
            Password
          </label>
          <Password
            inputId="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            feedback={false}
            toggleMask
            inputClassName="w-full bg-white"
            className="w-full"
          />
        </div>

        {loginError && (
          <Message
            severity="error"
            text={
              (loginError.body?.detail as string | undefined) ??
              'Invalid username or password.'
            }
          />
        )}

        <Button
          type="submit"
          label="Log In"
          loading={loggingIn}
          disabled={!username.trim() || !password}
          className="!border-brand-accent-active !bg-brand-accent-active font-bold !text-white"
        />

        <div className="flex justify-between text-sm text-slate-600">
          <Link
            to="/forgot-password"
            className="font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
          >
            Forgot password?
          </Link>
          <span>
            No account?{' '}
            <Link
              to="/signup"
              className="font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
            >
              Sign up
            </Link>
          </span>
        </div>
      </form>
    </div>
  );
}
