import { NextResponse } from 'next/server';

export function middleware(request) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

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
