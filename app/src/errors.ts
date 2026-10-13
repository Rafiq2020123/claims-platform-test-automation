export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Claim') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to do that.');
export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Please sign in.');
