import { config } from 'dotenv';
config();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { emailRouter } from './routes/email.routes';
import { authRouter } from './routes/auth.routes';
import admin from 'firebase-admin';

const app = express();
const port = process.env.PORT || 3001;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/emails', emailRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('../firebase-service-account.json')),
  });
}

export const db = admin.firestore();

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 