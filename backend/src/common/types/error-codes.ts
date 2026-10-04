import { HttpStatus } from '@nestjs/common';

/**
 * Every error code the API can return.
 *
 * The generic codes map 1:1 onto an HTTP status (rule #9); the domain codes are
 * the specific reasons a game action was refused and are what the frontend
 * switches on. Keeping them in one union means a typo in a `throw` is a compile
 * error rather than a mystery string in a response body.
 */
export type ErrorCode =
  // generic, one per status
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'INTERNAL_SERVER_ERROR'
  // auth
  | 'EMAIL_TAKEN'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REFRESH_TOKEN'
  | 'INSUFFICIENT_ROLE'
  // quests
  | 'QUEST_INACTIVE'
  | 'QUEST_ALREADY_COMPLETED'
  | 'OUTSIDE_QUEST_RADIUS'
  // hunts
  | 'HUNT_NOT_PUBLISHED'
  | 'HUNT_ALREADY_JOINED'
  | 'HUNT_NOT_JOINED'
  | 'HUNT_COMPLETED'
  | 'OUT_OF_ORDER_DISCOVERY'
  | 'INVALID_KEY'
  | 'WRONG_ANSWER';

/** Default code for each HTTP status, used when mapping framework exceptions. */
export const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'BUSINESS_RULE_VIOLATION',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
};

/** Shape of the `error` object in every failed response (rule #9). */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Full error envelope returned by the global exception filter. */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  timestamp: string;
  path: string;
}