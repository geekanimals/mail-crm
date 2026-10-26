// This app has no Server Actions and no page takes a POST (the API is the separate backend).
// Bots POST fake Server Action requests (a "Next-Action" header, or a form with $ACTION_ID fields)
// that only fill the logs with "Failed to find Server Action" errors - answer them here first.
import { NextResponse } from 'next/server';

export function proxy(request) {
  if (request.headers.has('next-action') || !['GET', 'HEAD'].includes(request.method)) return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: '/((?!api/|_next/static|_next/image|favicon.ico).*)' };
