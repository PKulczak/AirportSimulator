/** GET /api/auth/me/ shape — "who am I logged in as". Django's built-in User
 * model is used as-is (no custom user model, no self-serve signup — Slice
 * 9.1 is auth mechanics only). */
export interface AuthUser {
  id: number;
  username: string;
  email: string;
  isStaff: boolean;
}

/** Shared response shape for every endpoint that logs the caller in — login,
 * self-serve signup (Slice B.2), and password-reset confirmation all return
 * the same {token, user} pair. */
export interface AuthTokenResponse {
  token: string;
  user: AuthUser;
}

/** POST /api/auth/register/ request body (Slice B.2). */
export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

/** POST /api/auth/password-reset/ request body (Slice B.2). Always 204s
 * regardless of whether `email` matches an account — see the backend view's
 * docstring for why. */
export interface PasswordResetRequest {
  email: string;
}

/** POST /api/auth/password-reset/confirm/ request body (Slice B.2). `uid`
 * and `token` come straight from the emailed reset link's URL. */
export interface PasswordResetConfirmRequest {
  uid: string;
  token: string;
  password: string;
  passwordConfirm: string;
}
