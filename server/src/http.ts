import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Thrown by route handlers for expected, client-facing failures. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (message: string) => new HttpError(404, message);
export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message: string) => new HttpError(401, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Wraps an async handler so rejected promises reach the error middleware instead of becoming unhandled rejections. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
}

export function paginationFor(page: number, pageSize: number, total: number): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const empty = total === 0 || offset >= total;
  return {
    page,
    pageSize,
    total,
    totalPages,
    from: empty ? 0 : offset + 1,
    to: empty ? 0 : Math.min(page * pageSize, total),
  };
}

/** Postgres `unique_violation`. pg surfaces the SQLSTATE on `code`. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // A unique-index violation is a client problem — a duplicate — not a server
  // fault, and it is reachable by racing two writes past a pre-check. Routes
  // that can name the colliding field should still throw conflict() with a
  // message an admin can act on; this is the backstop.
  if (isUniqueViolation(err)) {
    res.status(409).json({ error: 'That record already exists.' });
    return;
  }
  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
}
