import { NextResponse } from 'next/server';

// Basic auth for the whole app — the dashboard holds candidate personal data.
export function middleware(req) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next();
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Basic ')) {
    const [, pass] = atob(h.slice(6)).split(':');
    if (pass === pw) return NextResponse.next();
  }
  return new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Kargo Hiring"' } });
}

export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
