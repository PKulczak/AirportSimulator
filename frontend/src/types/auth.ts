/** GET /api/auth/me/ shape — "who am I logged in as". Django's built-in User
 * model is used as-is (no custom user model, no self-serve signup — Slice
 * 9.1 is auth mechanics only). */
export interface AuthUser {
  id: number;
  username: string;
  email: string;
  isStaff: boolean;
}

/** POST /api/auth/login/ response body. */
export interface LoginResponse {
  token: string;
  user: AuthUser;
}
