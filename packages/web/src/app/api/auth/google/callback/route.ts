import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect('/?error=no_code');
  }

  try {
    // Forward the code to our backend
    const response = await fetch(`${backendUrl}/api/auth/google/callback?code=${code}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Authentication failed');
    }

    // Get the session cookie from the backend response
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      const cookieValue = setCookieHeader.split(';')[0].split('=')[1];
      
      // Create a response with the redirect
      const redirectResponse = NextResponse.redirect('/dashboard');
      
      // Set the cookie on the response
      redirectResponse.cookies.set('session', cookieValue, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      return redirectResponse;
    }

    // If no cookie was set, redirect to error page
    return NextResponse.redirect('/?error=no_session');
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.redirect('/?error=auth_failed');
  }
} 