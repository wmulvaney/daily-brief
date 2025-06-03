declare module "express-serve-static-core" {
  interface Request {
    user?: any;
  }
}

import { Router, Request, Response, NextFunction } from 'express';
import { EmailService } from '@/services/email.service';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { OpenAI } from 'openai';
import { db } from '../index';
import { OAuth2Client } from 'google-auth-library';
import * as admin from 'firebase-admin';

const router = Router();
const emailService = new EmailService();
const JWT_SECRET = process.env.SESSION_SECRET || 'your-secret-key';

// Middleware to check JWT
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  console.log('[DEBUG] Authorization header:', authHeader);
  if (!authHeader) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    console.log('[DEBUG] Decoded JWT:', req.user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Get email summary (fetch from Firestore)
router.get('/summary', requireAuth, async (req, res) => {
  const userEmail = req.user?.user?.email;
  if (!userEmail) {
    return res.status(401).json({ error: 'No user email found' });
  }
  try {
    const doc = await db.collection('summaries').doc(userEmail).get();
    if (!doc.exists) {
      return res.json({});
    }
    const data = doc.data();
    res.json({ summary: data?.summary || {}, metaSummary: data?.metaSummary || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary', details: err instanceof Error ? err.message : err });
  }
});

// Get email summary
router.post('/summarize', async (req, res, next) => {
  try {
    const { emails } = req.body;
    const summary = await emailService.summarizeEmails(emails);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// Get user's email preferences
router.get('/preferences', async (req, res, next) => {
  try {
    // TODO: Implement user preferences retrieval
    res.json({
      notificationTime: '09:00',
      summaryFormat: 'concise',
    });
  } catch (error) {
    next(error);
  }
});

// Update user's email preferences
router.put('/preferences', requireAuth, async (req, res, next) => {
  try {
    const userEmail = req.user?.user?.email;
    if (!userEmail) {
      return res.status(401).json({ error: 'No user email found' });
    }
    const { notificationTime, summaryFormat } = req.body;
    const updateData: Record<string, any> = {};
    if (notificationTime !== undefined) updateData.notificationTime = notificationTime;
    if (summaryFormat !== undefined) updateData.summaryFormat = summaryFormat;

    // Update user preferences in Firestore (only notificationTime and summaryFormat)
    await db.collection('users').doc(userEmail).set(updateData, { merge: true });
    res.json({
      message: 'Preferences updated successfully',
      preferences: {
        notificationTime,
        summaryFormat,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Sync emails and generate summary (fetch tokens from Firestore, store summary in Firestore)
router.post('/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const userEmail = req.user?.user?.email;
    if (!userEmail) {
      return res.status(401).json({ error: 'No user email found' });
    }

    // Fetch tokens from Firestore
    const userDoc = await db.collection('users').doc(userEmail).get();
    const userData = userDoc.data();
    const refreshToken = userData?.refreshToken;
    
    if (!refreshToken) {
      console.error('[ERROR] No refresh token found for user:', userEmail);
      return res.status(401).json({ error: 'No refresh token found' });
    }

    // Refresh access token
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    try {
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();
      console.log('[DEBUG] Successfully refreshed access token');
      await db.collection('users').doc(userEmail).update({
        accessToken: credentials.access_token,
        updatedAt: new Date()
      });

      // Fetch last sync time from Firestore
      const userMetaDoc = await db.collection('users').doc(userEmail).get();
      const userMeta = userMetaDoc.data();
      let lastSyncTime = userMeta?.lastSyncTime;
      let since;
      if (lastSyncTime) {
        since = new Date(lastSyncTime);
      } else {
        since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }
      const query = `in:inbox after:${Math.floor(since.getTime() / 1000)}`;

      // Fetch emails from Gmail (last 24 hours)
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 30, // Slightly higher for more coverage
      });
      const messages = listRes.data.messages || [];
      const emails = [];
      for (const msg of messages) {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: msg.id!, format: 'full' });
        const headers = msgRes.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';
        let body = '';
        if (msgRes.data.payload?.parts) {
          const part = msgRes.data.payload.parts.find(p => p.mimeType === 'text/plain');
          if (part && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        } else if (msgRes.data.payload?.body?.data) {
          body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
        }
        // Extract date from headers or use current date
        const dateHeader = headers.find(h => h.name === 'Date')?.value;
        const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
        emails.push({ subject, from, body, date });
      }
      console.log(`[DEBUG] Fetched ${emails.length} emails from Gmail.`);
      if (emails.length === 0) {
        await db.collection('users').doc(userEmail).update({ lastSyncTime: new Date() });
        const doc = await db.collection('summaries').doc(userEmail).get();
        const data = doc.data();
        console.log('[DEBUG] No new emails. Returning previous summary/metaSummary:', JSON.stringify({ summary: data?.summary || {}, metaSummary: data?.metaSummary || '' }, null, 2));
        return res.json({ summary: data?.summary || {}, metaSummary: data?.metaSummary || '' });
      }
      // --- Stage 1: Classify using only subject and sender ---
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const classifyPrompt = `Classify the following emails into these categories: Urgent, Important, Good to know, Not important, Spam. For each, provide the subject and sender. Respond in JSON with keys: urgent, important, goodToKnow, notImportant, spam. Each value should be an array of objects with fields: subject, sender.\n\n${emails.map((e, i) => `Email ${i+1}:\nFrom: ${e.from}\nSubject: ${e.subject}`).join('\n\n')}`;
      const classifyCompletion = await openai.chat.completions.create({
        model: "gpt-4-1106-preview",
        messages: [
          {
            role: "system",
            content: "You are an email assistant that classifies emails."
          },
          {
            role: "user",
            content: classifyPrompt
          }
        ],
        response_format: { type: "json_object" }
      });
      let classified;
      try {
        classified = JSON.parse(classifyCompletion.choices[0].message.content || '{}');
        console.log('[DEBUG] Classification result:', JSON.stringify(classified, null, 2));
      } catch {
        console.error('[ERROR] Failed to parse LLM classification response:', classifyCompletion.choices[0].message.content);
        return res.status(500).json({ error: 'Failed to parse LLM classification response' });
      }
      // Collect indices of relevant emails
      const relevantCategories = ['urgent', 'important', 'goodToKnow'];
      const relevantSubjects = new Set();
      for (const cat of relevantCategories) {
        if (Array.isArray(classified[cat])) {
          for (const item of classified[cat]) {
            if (item && item.subject) relevantSubjects.add(item.subject);
          }
        }
      }
      // Filter emails for next stage
      const relevantEmails = emails.filter(e => relevantSubjects.has(e.subject));
      console.log(`[DEBUG] ${relevantEmails.length} relevant emails selected for summarization.`);
      if (relevantEmails.length === 0) {
        await db.collection('summaries').doc(userEmail).set({ summary: {} });
        console.log('[DEBUG] No relevant emails after classification. Empty summary saved.');
        return res.json({});
      }
      // --- Stage 2: Batch summarize relevant emails ---
      const batchSize = 5;
      const batches = [];
      for (let i = 0; i < relevantEmails.length; i += batchSize) {
        batches.push(relevantEmails.slice(i, i + batchSize));
      }
      const batchSummaries = [];
      for (const [batchIdx, batch] of batches.entries()) {
        const batchPrompt = `Summarize and classify the following emails. For each, provide the subject, sender, and a one-sentence summary. Respond in JSON with keys: urgent, important, goodToKnow, notImportant. Each value should be an array of objects with fields: subject, sender, summary, and date (ISO 8601).\n\n${batch.map((e, i) => `Email ${i+1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body}\nDate: ${e.date || new Date().toISOString()}`).join('\n\n')}`;
        const batchCompletion = await openai.chat.completions.create({
          model: "gpt-4-1106-preview",
          messages: [
            {
              role: "system",
              content: "You are an email assistant that classifies and summarizes emails."
            },
            {
              role: "user",
              content: batchPrompt
            }
          ],
          response_format: { type: "json_object" }
        });
        let batchSummary;
        try {
          batchSummary = JSON.parse(batchCompletion.choices[0].message.content || '{}');
          console.log(`[DEBUG] Batch ${batchIdx + 1} summary:`, JSON.stringify(batchSummary, null, 2));
        } catch {
          console.error(`[ERROR] Failed to parse LLM batch summary for batch ${batchIdx + 1}:`, batchCompletion.choices[0].message.content);
          continue; // skip this batch if parsing fails
        }
        batchSummaries.push(batchSummary);
      }
      // Merge batch summaries
      type Category = 'urgent' | 'important' | 'goodToKnow' | 'notImportant';
      const merged: Record<Category, any[]> = { urgent: [], important: [], goodToKnow: [], notImportant: [] };
      const categories: Category[] = ['urgent', 'important', 'goodToKnow', 'notImportant'];
      for (const summary of batchSummaries) {
        for (const key of categories) {
          if (Array.isArray(summary[key])) {
            merged[key] = merged[key].concat(summary[key]);
          }
        }
      }
      // --- Merge with existing summary and prune old emails ---
      const existingDoc = await db.collection('summaries').doc(userEmail).get();
      let existingSummary = existingDoc.exists ? existingDoc.data()?.summary : null;
      console.log('[DEBUG] Existing summary from Firestore:', JSON.stringify(existingSummary, null, 2));
      if (existingSummary) {
        for (const key of categories) {
          if (Array.isArray(existingSummary[key])) {
            merged[key] = merged[key].concat(existingSummary[key]);
          }
        }
      }
      console.log('[DEBUG] Merged summary before deduplication/pruning:', JSON.stringify(merged, null, 2));
      // Remove duplicates (by subject+sender+date)
      for (const key of categories) {
        const seen = new Set();
        merged[key] = merged[key].filter(email => {
          const id = `${email.subject}|${email.sender}|${email.date}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      }
      // Prune emails older than 48 hours
      const now = Date.now();
      const cutoff = now - 48 * 60 * 60 * 1000;
      for (const key of categories) {
        merged[key] = merged[key].filter(email => {
          if (!email.date) return true;
          const emailTime = new Date(email.date).getTime();
          return emailTime >= cutoff;
        });
      }
      console.log('[DEBUG] Merged summary after deduplication/pruning:', JSON.stringify(merged, null, 2));
      // --- Meta summary using ChatGPT ---
      const allEmails = categories.flatMap(key => merged[key]);
      let metaSummary = '';
      if (allEmails.length > 0) {
        const metaPrompt = `You are an AI assistant. Provide a 2 sentence, high-level summary of the user's inbox as a whole. Do NOT list or describe individual emails. Instead, generalize about the main topics, tone, and any important actions or trends you notice. Limit your response to 2-3 sentences.\n\n${allEmails.map((e, i) => `Email ${i+1}:\nFrom: ${e.sender}\nSubject: ${e.subject}\nSummary: ${e.summary}\nDate: ${e.date}`).join('\n\n')}`;
        try {
          const metaCompletion = await openai.chat.completions.create({
            model: "gpt-4-1106-preview",
            messages: [
              { role: "system", content: "You are an email assistant that summarizes emails for a user." },
              { role: "user", content: metaPrompt }
            ]
          });
          metaSummary = metaCompletion.choices[0].message.content || '';
        } catch (err) {
          metaSummary = '';
        }
      }
      console.log('[DEBUG] Final merged summary:', JSON.stringify(merged, null, 2));
      // Store summary and metaSummary in Firestore
      await db.collection('summaries').doc(userEmail).set({ summary: merged, metaSummary, createdAt: new Date() });
      // After successful sync, update lastSyncTime in Firestore
      await db.collection('users').doc(userEmail).update({ lastSyncTime: new Date() });
      console.log('[DEBUG] Returning new merged summary/metaSummary to frontend:', JSON.stringify({ ...merged, metaSummary }, null, 2));
      return res.json({ ...merged, metaSummary });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate summary', details: err instanceof Error ? err.message : err });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate summary', details: err instanceof Error ? err.message : err });
  }
});

// Add this endpoint to allow resetting lastSyncTime for the authenticated user
router.post('/reset-sync', requireAuth, async (req, res) => {
  const userEmail = req.user?.user?.email;
  if (!userEmail) return res.status(401).json({ error: 'No user email found' });
  try {
    await db.collection('users').doc(userEmail).update({ lastSyncTime: admin.firestore.FieldValue.delete() });
    res.json({ message: 'lastSyncTime reset' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset lastSyncTime', details: err instanceof Error ? err.message : err });
  }
});

export const emailRouter = router; 