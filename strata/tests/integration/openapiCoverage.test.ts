/**
 * The contract-drift gate (Step 13): every real route under /api/v1 must
 * appear in the published OpenAPI document with every method it exports.
 * Shipping an endpoint the spec does not mention fails the build here — the
 * app's own screens must make no API call outside the published contract.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spec } from '@/server/lib/openapi';

const API_ROOT = path.join(__dirname, '..', '..', 'src', 'app', 'api', 'v1');

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** `…/items/[id]/route.ts` → `/api/v1/items/{id}`. */
function toSpecPath(file: string): string {
  const rel = path.relative(API_ROOT, path.dirname(file));
  const wire = rel
    .split(path.sep)
    .map((seg) => seg.replace(/^\[(.+)\]$/, '{$1}'))
    .join('/');
  return `/api/v1/${wire}`;
}

function exportedMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return ['GET', 'POST', 'PATCH', 'DELETE'].filter((m) =>
    new RegExp(`export (async )?function ${m}\\b`).test(source),
  );
}

describe('OpenAPI coverage', () => {
  const files = collectRouteFiles(API_ROOT);

  it('found the API surface at all', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const specPath = toSpecPath(file);
    for (const method of exportedMethods(file)) {
      it(`${method} ${specPath} is in the published spec`, () => {
        const entry = (spec.paths as Record<string, Record<string, unknown>>)[specPath];
        expect(entry, `route file exists but ${specPath} is missing from src/server/lib/openapi.ts`).toBeDefined();
        expect(
          entry?.[method.toLowerCase()],
          `${specPath} exists in the spec but does not document ${method}`,
        ).toBeDefined();
      });
    }
  }
});
