import { getFile, verifyDownloadToken } from '@/server/lib/storage';
import { AppError } from '@/server/lib/errors';
import { toErrorResponse } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Error-CSV download. Auth is the signed token in the URL — a browser
 * download cannot send the `X-Workspace-Id` header, exactly like the spec's
 * signed Storage URLs.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
    const claim = verifyDownloadToken(token);
    const file = await getFile(claim.storagePath);
    return new Response(new Uint8Array(file), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="import-errors.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error, crypto.randomUUID());
    return Response.json(body, { status });
  }
}
