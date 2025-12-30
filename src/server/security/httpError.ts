// src/server/security/httpError.ts

export type HttpErrorLike = Error & { status?: number; headers?: Record<string, string> };

export function makeHttpError(status: number, message: string, headers?: Record<string, string>): HttpErrorLike {
  const err = new Error(message) as HttpErrorLike;
  err.status = status;
  if (headers) err.headers = headers;
  return err;
}