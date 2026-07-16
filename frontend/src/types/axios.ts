import type { ApiErrorBody } from './common';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** Normalised error shape surfaced by the axios hooks, regardless of failure cause. */
export interface ApiError {
  status?: number;
  message: string;
  body?: ApiErrorBody;
}

export interface UseAxiosState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

export interface UseGetResult<T> extends UseAxiosState<T> {
  refetch: () => void;
}

export interface UseMutationResult<TResponse, TBody> extends UseAxiosState<TResponse> {
  execute: (body: TBody) => Promise<TResponse | undefined>;
}
