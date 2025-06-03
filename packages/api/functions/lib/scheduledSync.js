"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledSync = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const google_auth_library_1 = require("google-auth-library");
const googleapis_1 = require("googleapis");
const openai_1 = require("openai");
// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
// Helper to check if current time matches user's notification time
function isTimeToSync(notificationTime) {
    const now = new Date();
    const [hours, minutes] = notificationTime.split(':').map(Number);
    return now.getUTCHours() === hours && now.getUTCMinutes() === minutes;
}
// Helper to perform sync for a single user
async function syncUserEmails(userEmail, refreshToken) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    try {
        // Refresh access token
        const oauth2Client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await oauth2Client.refreshAccessToken();
        // Update access token in Firestore
        await db.collection('users').doc(userEmail).update({
            accessToken: credentials.access_token,
            updatedAt: new Date()
        });
        // Fetch last sync time
        const userDoc = await db.collection('users').doc(userEmail).get();
        const userData = userDoc.data();
        let lastSyncTime = userData === null || userData === void 0 ? void 0 : userData.lastSyncTime;
        let since;
        if (lastSyncTime) {
            since = new Date(lastSyncTime);
        }
        else {
            since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        }
        // Fetch emails from Gmail
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth: oauth2Client });
        const query = `in:inbox after:${Math.floor(since.getTime() / 1000)}`;
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 30,
        });
        const messages = listRes.data.messages || [];
        if (messages.length === 0) {
            await db.collection('users').doc(userEmail).update({ lastSyncTime: new Date() });
            return;
        }
        // Process emails
        const emails = [];
        for (const msg of messages) {
            const msgRes = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
            const headers = ((_a = msgRes.data.payload) === null || _a === void 0 ? void 0 : _a.headers) || [];
            const subject = ((_b = headers.find(h => h.name === 'Subject')) === null || _b === void 0 ? void 0 : _b.value) || '';
            const from = ((_c = headers.find(h => h.name === 'From')) === null || _c === void 0 ? void 0 : _c.value) || '';
            let body = '';
            if ((_d = msgRes.data.payload) === null || _d === void 0 ? void 0 : _d.parts) {
                const part = msgRes.data.payload.parts.find(p => p.mimeType === 'text/plain');
                if (part && ((_e = part.body) === null || _e === void 0 ? void 0 : _e.data)) {
                    body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                }
            }
            else if ((_g = (_f = msgRes.data.payload) === null || _f === void 0 ? void 0 : _f.body) === null || _g === void 0 ? void 0 : _g.data) {
                body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
            }
            const dateHeader = (_h = headers.find(h => h.name === 'Date')) === null || _h === void 0 ? void 0 : _h.value;
            const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
            emails.push({ subject, from, body, date });
        }
        // Classify emails
        const openai = new openai_1.OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const classifyPrompt = `Classify the following emails into these categories: Urgent, Important, Good to know, Not important, Spam. For each, provide the subject and sender. Respond in JSON with keys: urgent, important, goodToKnow, notImportant, spam. Each value should be an array of objects with fields: subject, sender.\n\n${emails.map((e, i) => `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}`).join('\n\n')}`;
        const classifyCompletion = await openai.chat.completions.create({
            model: "gpt-4-1106-preview",
            messages: [
                { role: "system", content: "You are an email assistant that classifies emails." },
                { role: "user", content: classifyPrompt }
            ],
            response_format: { type: "json_object" }
        });
        let classified;
        try {
            classified = JSON.parse(classifyCompletion.choices[0].message.content || '{}');
        }
        catch (_k) {
            console.error(`[ERROR] Failed to parse classification for user ${userEmail}`);
            return;
        }
        // Process relevant emails
        const relevantCategories = ['urgent', 'important', 'goodToKnow'];
        const relevantSubjects = new Set();
        for (const cat of relevantCategories) {
            if (Array.isArray(classified[cat])) {
                for (const item of classified[cat]) {
                    if (item && item.subject)
                        relevantSubjects.add(item.subject);
                }
            }
        }
        const relevantEmails = emails.filter(e => relevantSubjects.has(e.subject));
        if (relevantEmails.length === 0) {
            await db.collection('summaries').doc(userEmail).set({ summary: {} });
            await db.collection('users').doc(userEmail).update({ lastSyncTime: new Date() });
            return;
        }
        // Batch summarize relevant emails
        const batchSize = 5;
        const batches = [];
        for (let i = 0; i < relevantEmails.length; i += batchSize) {
            batches.push(relevantEmails.slice(i, i + batchSize));
        }
        const batchSummaries = [];
        for (const batch of batches) {
            const batchPrompt = `Summarize and classify the following emails. For each, provide the subject, sender, and a one-sentence summary. Respond in JSON with keys: urgent, important, goodToKnow, notImportant. Each value should be an array of objects with fields: subject, sender, summary, and date (ISO 8601).\n\n${batch.map((e, i) => `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nBody: ${e.body}\nDate: ${e.date}`).join('\n\n')}`;
            const batchCompletion = await openai.chat.completions.create({
                model: "gpt-4-1106-preview",
                messages: [
                    { role: "system", content: "You are an email assistant that classifies and summarizes emails." },
                    { role: "user", content: batchPrompt }
                ],
                response_format: { type: "json_object" }
            });
            try {
                const batchSummary = JSON.parse(batchCompletion.choices[0].message.content || '{}');
                batchSummaries.push(batchSummary);
            }
            catch (_l) {
                console.error(`[ERROR] Failed to parse batch summary for user ${userEmail}`);
                continue;
            }
        }
        const merged = { urgent: [], important: [], goodToKnow: [], notImportant: [] };
        const categories = ['urgent', 'important', 'goodToKnow', 'notImportant'];
        for (const summary of batchSummaries) {
            for (const key of categories) {
                if (Array.isArray(summary[key])) {
                    merged[key] = merged[key].concat(summary[key]);
                }
            }
        }
        // Merge with existing summary
        const existingDoc = await db.collection('summaries').doc(userEmail).get();
        const existingSummary = existingDoc.exists ? (_j = existingDoc.data()) === null || _j === void 0 ? void 0 : _j.summary : null;
        if (existingSummary) {
            for (const key of categories) {
                if (Array.isArray(existingSummary[key])) {
                    merged[key] = merged[key].concat(existingSummary[key]);
                }
            }
        }
        // Remove duplicates
        for (const key of categories) {
            const seen = new Set();
            merged[key] = merged[key].filter(email => {
                const id = `${email.subject}|${email.sender}|${email.date}`;
                if (seen.has(id))
                    return false;
                seen.add(id);
                return true;
            });
        }
        // Prune old emails
        const now = Date.now();
        const cutoff = now - 48 * 60 * 60 * 1000;
        for (const key of categories) {
            merged[key] = merged[key].filter(email => {
                if (!email.date)
                    return true;
                const emailTime = new Date(email.date).getTime();
                return emailTime >= cutoff;
            });
        }
        // Generate meta summary
        const allEmails = categories.flatMap(key => merged[key]);
        let metaSummary = '';
        if (allEmails.length > 0) {
            const metaPrompt = `You are an AI assistant. Provide a 2 sentence, high-level summary of the user's inbox as a whole. Do NOT list or describe individual emails. Instead, generalize about the main topics, tone, and any important actions or trends you notice. Limit your response to 2-3 sentences.\n\n${allEmails.map((e, i) => `Email ${i + 1}:\nFrom: ${e.sender}\nSubject: ${e.subject}\nSummary: ${e.summary}\nDate: ${e.date}`).join('\n\n')}`;
            try {
                const metaCompletion = await openai.chat.completions.create({
                    model: "gpt-4-1106-preview",
                    messages: [
                        { role: "system", content: "You are an email assistant that summarizes emails for a user." },
                        { role: "user", content: metaPrompt }
                    ]
                });
                metaSummary = metaCompletion.choices[0].message.content || '';
            }
            catch (err) {
                console.error(`[ERROR] Failed to generate meta summary for user ${userEmail}:`, err);
            }
        }
        // Store results
        await db.collection('summaries').doc(userEmail).set({
            summary: merged,
            metaSummary,
            createdAt: new Date()
        });
        await db.collection('users').doc(userEmail).update({ lastSyncTime: new Date() });
    }
    catch (error) {
        console.error(`[ERROR] Failed to sync emails for user ${userEmail}:`, error);
    }
}
// Cloud Function that runs every minute
exports.scheduledSync = functions.pubsub
    .schedule('every 1 minutes')
    .onRun(async (context) => {
    try {
        // Get all users
        const usersSnapshot = await db.collection('users').get();
        // Filter users whose notification time matches current time
        const usersToSync = usersSnapshot.docs.filter(doc => {
            const data = doc.data();
            return data.notificationTime && isTimeToSync(data.notificationTime);
        });
        // Sync emails for matching users
        const syncPromises = usersToSync.map(doc => {
            const data = doc.data();
            if (!data.refreshToken) {
                console.error(`[ERROR] No refresh token for user ${doc.id}`);
                return Promise.resolve();
            }
            return syncUserEmails(doc.id, data.refreshToken);
        });
        await Promise.all(syncPromises);
        console.log(`[INFO] Completed scheduled sync for ${usersToSync.length} users`);
    }
    catch (error) {
        console.error('[ERROR] Scheduled sync failed:', error);
    }
});
//# sourceMappingURL=scheduledSync.js.map