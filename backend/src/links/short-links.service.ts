import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { randomShortCode } from '../common/utils/short-code.js';
import { MAX_TARGET_LENGTH } from './dto/create-short-link.dto.js';

const UNIQUE_VIOLATION = 'P2002';

/** Shared by every "this code isn't a link" path — one sentence, one place. */
const NOT_FOUND_MESSAGE = 'That short link does not exist — ask for a fresh one.';

/** A short code as issued: its code, and the (origin-stripped) target it opens. */
export interface ShortLinkDto {
  /** The 6-character code, e.g. `MQ7X91`. */
  code: string;
  /** The stored target — a path on this app, never an absolute URL. */
  target: string;
}

/**
 * Store-and-redirect short links: a 6-character code standing for a full
 * invite URL, so a self-contained join link (which embeds the entire hunt and
 * runs to tens of KB) can be passed around as `…/g/MQ7X91`.
 *
 * The receiver is unchanged: opening a short code issues an ordinary redirect
 * to `/games#join=…`, and the existing fragment handler in `app/games` takes
 * over from there. Nothing about what a join *is* moves to the server.
 */
@Injectable()
export class ShortLinksService {
  private readonly logger = new Logger(ShortLinksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues (or reissues) the code for `rawTarget`.
   *
   * Idempotent on the target: re-sharing the same hunt hands back the code it
   * already has rather than writing a second row, so opening a share sheet a
   * hundred times costs one insert.
   */
  async mint(rawTarget: string, createdBy?: string): Promise<ShortLinkDto> {
    const target = normaliseTarget(rawTarget);
    const targetHash = sha256(target);

    const existing = await this.prisma.shortLink.findUnique({
      where: { targetHash },
      select: { code: true },
    });
    if (existing) return { code: existing.code, target };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const created = await this.prisma.shortLink.create({
          data: { code: randomShortCode(), target, targetHash, createdBy: createdBy ?? null },
        });
        return { code: created.code, target };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        // Two things trip the unique indexes: a drawn code colliding with an
        // existing link, and a concurrent mint of this very target. Re-reading
        // by hash tells them apart — the lost race degrades gracefully, the
        // collision just draws again.
        const raced = await this.prisma.shortLink.findUnique({
          where: { targetHash },
          select: { code: true },
        });
        if (raced) return { code: raced.code, target };
      }
    }

    this.logger.warn('Could not allocate a short link after 8 attempts');
    throw ApiException.conflict('CONFLICT', 'Could not create a short link — please try again.');
  }

  /** The stored target for `code`, or a 404. Counts the open. */
  async resolve(code: string): Promise<ShortLinkDto> {
    const normalised = (code ?? '').trim().toUpperCase();
    // Guard before the lookup: `code` is a `VARCHAR(8)` primary key, and MySQL
    // answers an over-long value with a data error rather than a miss.
    if (!/^[A-Z0-9]{1,8}$/.test(normalised)) {
      throw ApiException.notFound('NOT_FOUND', NOT_FOUND_MESSAGE);
    }

    const link = await this.prisma.shortLink.findUnique({
      where: { code: normalised },
      select: { code: true, target: true },
    });
    if (!link) throw ApiException.notFound('NOT_FOUND', NOT_FOUND_MESSAGE);

    // Bookkeeping must never be what stands between a player and the invite:
    // fire and forget, and let a failed increment log rather than fail the open.
    void this.prisma.shortLink
      .update({ where: { code: link.code }, data: { hits: { increment: 1 } } })
      .catch((error: unknown) => this.logger.warn(`hits increment failed: ${String(error)}`));

    return { code: link.code, target: link.target };
  }
}

/**
 * Turns a submitted URL into the only thing that is ever stored: whatever
 * follows the origin.
 *
 * This function *is* the open-redirect defence. A shortener that redirects to
 * whatever it was handed is a phishing service with extra steps, so:
 *
 *  1. only `http`/`https` pass — `javascript:`, `data:` and friends are gone
 *     before anything else looks at them;
 *  2. the origin is dropped, leaving a path that starts with a single `/`.
 *     Because the resolver redirects *relatively*, the destination host is the
 *     one serving the redirect and can never be chosen by the caller;
 *  3. `//host` (protocol-relative) and `\` are rejected outright — both are the
 *     well-known ways a "path" gets read as off-origin by one browser or
 *     another.
 */
function normaliseTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw ApiException.badRequest('VALIDATION_ERROR', 'A short link needs a target URL.');
  }
  if (trimmed.length > MAX_TARGET_LENGTH) {
    throw ApiException.badRequest(
      'VALIDATION_ERROR',
      `That link is too long to shorten (limit ${MAX_TARGET_LENGTH} characters).`,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw ApiException.badRequest(
      'VALIDATION_ERROR',
      'A short link target must be an absolute http(s) URL.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ApiException.badRequest(
      'VALIDATION_ERROR',
      'A short link can only point at an http(s) page.',
    );
  }

  const relative = `${url.pathname}${url.search}${url.hash}`;
  if (!relative.startsWith('/') || relative.startsWith('//') || relative.includes('\\')) {
    throw ApiException.badRequest(
      'VALIDATION_ERROR',
      'That link does not point at a page this app can redirect to.',
    );
  }
  return relative;
}

/** `sha256` of the stored target, as lowercase hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** True when Prisma reported a unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
  );
}

