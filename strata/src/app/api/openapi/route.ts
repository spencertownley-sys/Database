import { spec } from '@/server/lib/openapi';

export const dynamic = 'force-static';

/**
 * `GET /api/openapi` — the machine-readable contract for `/api/v1`.
 *
 * The document is assembled in `src/server/lib/openapi.ts`, and a contract
 * test (`tests/integration/openapiCoverage.test.ts`) walks the real route
 * files and fails the build when an endpoint exists that the spec does not
 * mention — drift between the app's API and the published contract is a test
 * failure, not a surprise.
 */
export function GET(): Response {
  return Response.json(spec, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
