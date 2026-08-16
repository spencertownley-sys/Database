import { getFile, verifyDownloadToken } from '@/server/lib/storage';
import { AppError, toErrorResponse } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

/** Signed-token download — the token, not a session, is the auth. */
export async function GET(request: Request): Promise<Response> {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
    const claim = verifyDownloadToken(token);
    const file = await getFile(claim.storagePath);
    return new Response(new Uint8Array(file), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="export.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error, crypto.randomUUID());
    return Response.json(body, { status });
  }
}
