// This app has no Server Actions. Bots send fake "Next-Action" POSTs that only fill the logs
// with "Server Reference ID did not match" errors - answer them here, before Next.js tries to run them.
import { NextResponse } from 'next/server';

export function proxy(request) {
  if (request.headers.has('next-action')) return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
