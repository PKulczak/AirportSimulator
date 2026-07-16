import axios, { type AxiosRequestConfig } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiError,
  HttpMethod,
  UseGetResult,
  UseMutationResult,
} from '../types/axios';
import type { ApiErrorBody } from '../types/common';

/** Single shared axios instance for the whole app. */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    return {
      status: err.response?.status,
      message: err.message,
      body: err.response?.data as ApiErrorBody | undefined,
    };
  }
  return { message: err instanceof Error ? err.message : 'Unknown error' };
}

/**
 * Generic request hook: tracks data/loading/error, and aborts the previous
 * in-flight request (via AbortController) whenever a new one is issued or the
 * component unmounts.
 */
function useAxios<TResponse>(method: HttpMethod, url: string, config?: AxiosRequestConfig) {
  const [data, setData] = useState<TResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const execute = useCallback(
    async (body?: unknown): Promise<TResponse | undefined> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.request<TResponse>({
          method,
          url,
          data: body,
          signal: controller.signal,
          ...configRef.current,
        });
        setData(response.data);
        return response.data;
      } catch (err) {
        if (axios.isCancel(err)) {
          return undefined;
        }
        setError(toApiError(err));
        return undefined;
      } finally {
        if (controllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [method, url],
  );

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { data, setData, loading, error, execute };
}

/**
 * Fires automatically on mount and whenever `url` changes. Callers that need
 * to refetch on query-param changes should bake those params into `url`
 * (e.g. via a template string) so the effect dependency captures them.
 * Exposes `refetch()` for manual refresh (the only re-fetch mechanism in this
 * app — there is deliberately no polling, see CLAUDE.md).
 */
export function useGet<TResponse>(
  url: string | null,
  config?: AxiosRequestConfig,
): UseGetResult<TResponse> {
  const { data, loading, error, execute } = useAxios<TResponse>('get', url ?? '', config);

  useEffect(() => {
    if (url) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const refetch = useCallback(() => {
    if (url) {
      execute();
    }
  }, [url, execute]);

  return { data, loading, error, refetch };
}

/** Does not auto-fire; exposes `execute(body)` for imperative submission (e.g. forms). */
export function usePost<TResponse, TBody = unknown>(
  url: string,
  config?: AxiosRequestConfig,
): UseMutationResult<TResponse, TBody> {
  const { data, loading, error, execute } = useAxios<TResponse>('post', url, config);
  const run = useCallback((body: TBody) => execute(body), [execute]);
  return { data, loading, error, execute: run };
}

/** Does not auto-fire; exposes `execute(body)` for imperative submission. */
export function usePut<TResponse, TBody = unknown>(
  url: string,
  config?: AxiosRequestConfig,
): UseMutationResult<TResponse, TBody> {
  const { data, loading, error, execute } = useAxios<TResponse>('put', url, config);
  const run = useCallback((body: TBody) => execute(body), [execute]);
  return { data, loading, error, execute: run };
}
