import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { usePost } from '../functions/axios';
import { useAuth } from '../context/AuthContext';
import { fieldError, generalError } from '../functions/apiErrors';
import type { AuthTokenResponse, PasswordResetConfirmRequest } from '../types/auth';

/**
 * Slice B.2 — the page a password-reset email's link lands on
 * (`/reset-password/:uid/:token`, matching `PasswordResetRequestView`'s
 * emailed URL). A successful confirm returns the same {token, user} shape as
 * login/signup (see AuthContext.completeAuth), so submitting this form logs
 * the caller straight back in rather than bouncing to a separate login step.
 */
export default function ResetPasswordPage() {
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const navigate = useNavigate();
  const { completeAuth } = useAuth();
  const { execute, loading, error } = usePost<AuthTokenResponse, PasswordResetConfirmRequest>(
    '/api/auth/password-reset/confirm/',
  );
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const passwordsMismatched = passwordConfirm.length > 0 && password !== passwordConfirm;

  if (!uid || !token) {
    return (
      <div className="flex justify-center py-24">
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-brand-bg p-8">
          <Message severity="error" text="This password reset link is invalid." className="w-full" />
          <p className="text-center text-sm text-slate-600">
            <Link
              to="/forgot-password"
              className="font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
            >
              Request a new link
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordsMismatched) {
      return;
    }
    const result = await execute({ uid, token, password, passwordConfirm });
    if (result) {
      completeAuth(result);
      navigate('/');
    }
  };

  return (
    <div className="flex justify-center py-24">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-brand-bg p-8"
      >
        <h1 className="text-center text-2xl font-semibold text-slate-800">Reset Password</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="reset-password" className="text-sm font-bold text-slate-800">
            New Password
          </label>
          <Password
            inputId="reset-password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            toggleMask
            inputClassName="w-full bg-white"
            className="w-full"
          />
          {fieldError(error, 'password') && (
            <small className="text-red-600">{fieldError(error, 'password')}</small>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="reset-password-confirm" className="text-sm font-bold text-slate-800">
            Confirm New Password
          </label>
          <Password
            inputId="reset-password-confirm"
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
          {!passwordsMismatched && fieldError(error, 'passwordConfirm') && (
            <small className="text-red-600">{fieldError(error, 'passwordConfirm')}</small>
          )}
        </div>

        {generalError(error) && <Message severity="error" text={generalError(error) as string} />}

        <Button
          type="submit"
          label="Reset Password"
          loading={loading}
          disabled={!password || passwordsMismatched}
          className="!border-brand-accent-active !bg-brand-accent-active font-bold !text-white"
        />
      </form>
    </div>
  );
}
