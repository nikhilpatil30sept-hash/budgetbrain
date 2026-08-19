/**
 * Thin fetch wrapper for the Express API. Everything goes through the Vite
 * dev proxy (/api → localhost:3001) — no keys, no external hosts, ever.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError("Can't reach the server — is `npm run dev` running?", 0);
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body — fall through
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; fields?: Record<string, string> };
    const fieldMsg = b.fields ? Object.values(b.fields)[0] : undefined;
    throw new ApiError(b.message ?? fieldMsg ?? b.error ?? `Request failed (${res.status})`, res.status, b.fields, b.error);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
