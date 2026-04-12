import { NextResponse } from 'next/server';

export function middleware(request) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname, searchParams } = request.nextUrl;

  // Allow guest access to /room when guest=true query param is present
  if (pathname.startsWith('/room') && searchParams.get('guest') === 'true') {
    return NextResponse.next();
  }

  const protectedRoutes = ['/dashboard', '/room', '/webinar'];
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtected && !token) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/room/:path*', '/webinar/:path*'],
};
