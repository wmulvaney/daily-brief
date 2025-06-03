import { Router, Request, Response, NextFunction } from 'express';
import { GoogleAuthService } from '@/services/google-auth.service';
import jwt from 'jsonwebtoken';
import { db } from '../index';

// Extend session type to include tokens and user
import 'express-session';
declare module 'express-session' {
  interface SessionData {
    tokens?: any;
    user?: any;
  }
}

const router = Router();
const googleAuthService = new GoogleAuthService();
const JWT_SECRET = process.env.SESSION_SECRET || 'your-secret-key';

// Initialize Google OAuth
router.get('/google', (req: Request, res: Response) => {
  const authUrl = googleAuthService.getAuthUrl();
  res.redirect(authUrl);
});

// Google OAuth callback
router.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.query;
    
    if (!code || typeof code !== 'string') {
      throw new Error('Authorization code is required');
    }

    const tokens = await googleAuthService.getTokens(code);
    googleAuthService.setCredentials(tokens);
    const userInfo = await googleAuthService.getUserInfo(tokens.access_token!);

    console.log('[DEBUG] Google tokens:', tokens);
    console.log('[DEBUG] Google userInfo:', userInfo);

    if (!userInfo.email) {
      console.warn('[WARN] User email is missing from Google user info');
      throw new Error('User email is missing from Google user info');
    }
    if (!tokens.refresh_token) {
      console.warn('[WARN] No refresh token received. This may happen if the user previously authorized the app.');
    }

    // Store/update user tokens in Firestore
    try {
      await db.collection('users').doc(userInfo.email).set({
        email: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokens,
        updatedAt: new Date(),
      }, { merge: true });
      console.log('[DEBUG] Successfully wrote user to Firestore:', userInfo.email);
    } catch (firestoreError) {
      console.error('[ERROR] Firestore write failed:', firestoreError);
      throw firestoreError;
    }

    // Generate JWT with user info (email only, tokens not needed in JWT)
    const token = jwt.sign({ user: { email: userInfo.email } }, JWT_SECRET, { expiresIn: '7d' });

    // Send JWT in response body
    res.redirect(`${process.env.FRONTEND_URL}/auth/success?token=${token}`);
  } catch (error) {
    next(error);
  }
});

// Get current user (expects JWT in Authorization header)
router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    res.json(decoded.user);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout (no-op for JWT)
router.post('/logout', (req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

export const authRouter = router; 