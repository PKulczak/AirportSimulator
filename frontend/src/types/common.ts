/** DRF-style pagination wrapper returned by list endpoints. */
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Shape of a DRF error response body (camelCase via djangorestframework-camel-case). */
export interface ApiErrorBody {
  detail?: string;
  [field: string]: unknown;
}
