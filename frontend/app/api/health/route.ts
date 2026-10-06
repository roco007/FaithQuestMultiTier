import { NextResponse } from 'next/server';
import { getServerApiBaseUrl, API_PREFIX } from '../../../api/client';

/**
 * Health check route handler (`GET /api/health`).
 *
 * Verifies connectivity to the backend at:
 * `https://faithquestmultitier.onrender.com/api/v1/health`
 */
export async function GET() {
  const backendBase = getServerApiBaseUrl();
  const healthUrl = `${backendBase}${API_PREFIX}/health`;

  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(
      {
        frontend: 'ok',
        backend: res.ok ? 'connected' : 'error',
        status: res.status,
        upstream: data,
        healthUrl,
      },
      { status: res.ok ? 200 : res.status },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        frontend: 'ok',
        backend: 'unreachable',
        error: message,
        healthUrl,
      },
      { status: 503 },
    );
  }
}
