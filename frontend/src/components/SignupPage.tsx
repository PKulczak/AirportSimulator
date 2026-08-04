import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useAuth } from '../context/AuthContext';
import { fieldError, generalError } from '../functions/apiErrors';

/**
 * Slice B.2 — self-serve signup, alongside LoginPage. Same plain
 * controlled-form approach as LoginPage (no react-hook-form/zod — a few
 * fields with only one cross-field rule doesn't need it). Password strength
 * and username-uniqueness are enforced server-side (see RegisterDto); this
 * form only checks the passwords match client-side before submitting, and
 * otherwise just surfaces whatever the API rejects.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const { register, registering, registerError } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const passwordsMismatched = passwordConfirm.length > 0 && password !== passwordConfirm;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordsMismatched) {
      return;
    }
    const success = await register({ username, email, password, passwordConfirm });
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
        <h1 className="text-center text-2xl font-semibold text-slate-800">Sign Up</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="signup-username" className="text-sm font-bold text-slate-800">
            Username
          </label>
          <InputText
            id="signup-username"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white"
          />
          {fieldError(registerError, 'username') && (
            <small className="text-red-600">{fieldError(registerError, 'username')}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="signup-email" className="text-sm font-bold text-slate-800">
            Email
          </label>
          <InputText
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white"
          />
          {fieldError(registerError, 'email') && (
            <small className="text-red-600">{fieldError(registerError, 'email')}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="signup-password" className="text-sm font-bold text-slate-800">
            Password
          </label>
          <Password
            inputId="signup-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            toggleMask
            inputClassName="w-full bg-white"
            className="w-full"
          />
          {fieldError(registerError, 'password') && (
            <small className="text-red-600">{fieldError(registerError, 'password')}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="signup-password-confirm" className="text-sm font-bold text-slate-800">
            Confirm Password
          </label>
          <Password
            inputId="signup-password-confirm"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            feedback={false}
            toggleMask
            inputClassName="w-full bg-white"
            className="w-full"
          />
          {passwordsMismatched && (
            <small className="text-red-600">Passwords do not match.</small>
          )}
          {!passwordsMismatched && fieldError(registerError, 'passwordConfirm') && (
            <small className="text-red-600">{fieldError(registerError, 'passwordConfirm')}</small>
          )}
        </div>

        {generalError(registerError) && (
          <Message severity="error" text={generalError(registerError) as string} />
        )}

        <Button
          type="submit"
          label="Sign Up"
          loading={registering}
          disabled={!username.trim() || !email.trim() || !password || passwordsMismatched}
          className="!border-brand-accent-active !bg-brand-accent-active font-bold !text-white"
        />

        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
          >
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
