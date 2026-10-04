import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiException, codeForStatus } from '../exceptions/api.exception.js';
import type { ApiErrorBody, ApiErrorResponse } from '../types/error-codes.js';

/**
 * Single exit point for every failure (rule #9).
 *
 * Any exception — ours, a Nest built-in (guards, `ValidationPipe`), or an
 * unexpected crash — leaves the API in the same envelope, so the frontend
 * client has exactly one error shape to parse.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // 500s are a bug: log the stack, never leak it to the client.
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: ApiErrorResponse = {
      success: false,
      error: body,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    };

    response.status(status).json(payload);
  }

  private describe(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof ApiException) {
      return {
        status: exception.getStatus(),
        body: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined ? {} : { details: exception.details }),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      // `ValidationPipe` returns `{ message: string[] , error, statusCode }`;
      // every other built-in returns a string.
      let message: string;
      let details: unknown;
      if (typeof payload === 'string') {
        message = payload;
      } else {
        const record = payload as Record<string, unknown>;
        const rawMessage = record.message;
        if (Array.isArray(rawMessage)) {
          message = 'Validation failed';
          details = { fields: rawMessage };
        } else if (typeof rawMessage === 'string') {
          message = rawMessage;
        } else {
          message = exception.message;
        }
      }
      return { status, body: { code: codeForStatus(status), message, ...(details === undefined ? {} : { details }) } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong on our side. Please try again.',
      },
    };
  }
}