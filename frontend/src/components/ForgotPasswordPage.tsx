import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { usePost } from '../functions/axios';
import { fieldError } from '../functions/apiErrors';
import type { PasswordResetRequest } from '../types/auth';

/**
 * Slice B.2 — requests a password-reset email. Always shows the same
 * "check your email" message on success regardless of whether the address
 * actually has an account (see PasswordResetRequestView) — this page has no
 * way to tell, by design, so it doesn't try to.
 */
export default function ForgotPasswordPage() {
  const { execute, loading, error } = usePost<unknown, PasswordResetRequest>(
    '/api/auth/password-reset/',
  );
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await execute({ email });
    // `!== undefined` (not truthiness) is the correct success check here —
    // a 204 response's `data` is `''`, which is falsy despite succeeding
    // (see usePost's doc comment).
    if (result !== undefined) {
      setSubmitted(true);
    }
  };

  return (
    <div className="flex justify-center py-24">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-brand-bg p-8"
      >
        <h1 className="text-center text-2xl font-semibold text-slate-800">
          Forgot Password
        </h1>

        {submitted ? (
          <Message
            severity="success"
            text="If that email has an account, a reset link is on its way — check your inbox."
            className="w-full"
          />
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Enter the email address on your account and we&apos;ll send you a link to reset
              your password.
            </p>

            <div className="flex flex-col gap-1">
              <label htmlFor="forgot-email" className="text-sm font-bold text-slate-800">
                Email
              </label>
              <InputText
                id="forgot-email"
                type="email"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white"
              />
              {fieldError(error, 'email') && (
                <small className="text-red-600">{fieldError(error, 'email')}</small>
              )}
            </div>

            <Button
              type="submit"
              label="Send Reset Link"
              loading={loading}
              disabled={!email.trim()}
              className="!border-brand-accent-active !bg-brand-accent-active font-bold !text-white"
            />
          </>
        )}

        <p className="text-center text-sm text-slate-600">
          <Link
            to="/login"
            className="font-semibold text-black underline decoration-brand-accent decoration-2 hover:decoration-brand-accent-hover"
          >
            Back to log in
          </Link>
        </p>
      </form>
    </div>
  );
}
