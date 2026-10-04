import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, STATUS_TO_CODE } from '../types/error-codes.js';

/**
 * The one exception type application code should throw.
 *
 * Carrying a machine-readable `code` alongside the HTTP status is what makes the
 * error contract in the brief possible: the frontend can react to
 * `OUTSIDE_QUEST_RADIUS` specifically, instead of pattern-matching a message.
 * `details` is an optional, non-sensitive payload (e.g. the measured distance).
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message, status);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthorized(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.UNAUTHORIZED, details);
  }

  static forbidden(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.FORBIDDEN, details);
  }

  static notFound(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.NOT_FOUND, details);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(code, message, HttpStatus.CONFLICT, details);
  }

  /** 422 — the request was well-formed but a game rule refused it. */
  static businessRule(code: ErrorCode, message: string, details?: unknown) {
    return new ApiException(
      code,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    );
  }
}

/** Falls back to the status' generic code when nothing more specific is known. */
export function codeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? 'INTERNAL_SERVER_ERROR';
}