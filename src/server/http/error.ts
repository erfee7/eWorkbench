// src/server/http/error.ts

export type HttpErrorLike = Error & { status?: number; headers?: Record<string, string> };

export function isHttpErrorLike(err: unknown): err is HttpErrorLike {
  return !!err && typeof err === 'object' && typeof (err as any).status === 'number';
}

export function makeHttpError(status: number, message: string, headers?: Record<string, string>): HttpErrorLike {
  const err = new Error(message) as HttpErrorLike;
  err.status = status;
  if (headers) err.headers = headers;
  return err;
}