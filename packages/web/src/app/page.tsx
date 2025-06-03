"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MdSync } from "react-icons/md";
import { FiSettings } from "react-icons/fi";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// Define types for summary and emails
interface SummaryEmail {
  subject: string;
  sender: string;
  summary: string;
}
interface Summary {
  urgent: SummaryEmail[];
  important: SummaryEmail[];
  goodToKnow: SummaryEmail[];
  notImportant: SummaryEmail[];
}

const CATEGORIES = ['urgent', 'important', 'goodToKnow', 'notImportant'] as const;
type Category = typeof CATEGORIES[number];

function getErrorMessage(error: string | null): string | null {
  if (!error) return null;
  switch (error) {
    case 'no_code':
      return 'No authorization code received from Google.';
    case 'auth_failed':
      return 'Authentication failed. Please try again.';
    case 'no_session':
      return 'Failed to create session. Please try again.';
    default:
      return 'An error occurred. Please try again.';
  }
}

function formatCooldown(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours > 0 ? hours + 'h ' : ''}${minutes}m ${seconds}s`;
}

// Helper to safely access summary category
function getSummaryCategory(summary: Summary | null, cat: Category): SummaryEmail[] {
  if (!summary) return [];
  return Array.isArray(summary[cat]) ? summary[cat] : [];
}

function localTimeToUTC(localTime, timeZone) {
  // localTime: "09:00", timeZone: "America/Chicago"
  const [hours, minutes] = localTime.split(':').map(Number);
  const now = new Date();
  // Set to today at the user's local time
  const localDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  // Convert to UTC string
  const utcDate = new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  return utcDate.toISOString().slice(11, 16); // "HH:MM"
}

export default function Home() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');
  const errorMessage = getErrorMessage(error);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notificationTime, setNotificationTime] = useState("09:00");
  const [isSyncing, setIsSyncing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [testModeCooldown, setTestModeCooldown] = useState(true);
  const [collapsed, setCollapsed] = useState<{ [key: string]: boolean }>({});
  const [metaSummary, setMetaSummary] = useState<string | null>(null);

  // On mount, check for cooldown
  useEffect(() => {
    const token = localStorage.getItem("jwt_token");
    const last = localStorage.getItem("last_sync_time");
    if (last) setLastSync(Number(last));
    if (token) {
      setIsAuthenticated(true);
      fetchSummary(token);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (!lastSync || (TEST_MODE && !testModeCooldown)) {
      setCooldownRemaining(0);
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = lastSync + SYNC_COOLDOWN_MS - now;
      setCooldownRemaining(remaining > 0 ? remaining : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSync, testModeCooldown]);

  // Set all categories collapsed by default
  useEffect(() => {
    setCollapsed(Object.fromEntries(CATEGORIES.map(cat => [cat, true])));
  }, []);

  const canSync = (TEST_MODE && !testModeCooldown) || !lastSync || (Date.now() - lastSync > SYNC_COOLDOWN_MS);

  const fetchSummary = async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/emails/summary`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[DEBUG] Summary API response:', data);
        const defaultSummary: Summary = {
          urgent: [],
          important: [],
          goodToKnow: [],
          notImportant: [],
        };
        if (data.summary && typeof data.summary === 'object') {
          // Merge the fetched summary with the default to ensure all categories exist
          setSummary({ ...defaultSummary, ...data.summary });
          setMetaSummary(data.metaSummary || null);
        } else {
          setSummary(defaultSummary);
          setMetaSummary(null);
        }
      } else {
        setSummary(null);
        setMetaSummary(null);
      }
    } catch {
      setSummary(null);
      setMetaSummary(null);
    }
    setLoading(false);
  };

  const handleSync = async () => {
    setShowSyncConfirm(false);
    setIsSyncing(true);
    const token = localStorage.getItem("jwt_token");
    console.log('[DEBUG] JWT token used for sync:', token);
    if (!token) {
      setIsAuthenticated(false);
      return;
    }
    const res = await fetch(`${API_URL}/api/emails/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    console.log('[DEBUG] Sync response status:', res.status);
    if (res.ok) {
      const data = await res.json();
      const defaultSummary: Summary = {
        urgent: [],
        important: [],
        goodToKnow: [],
        notImportant: [],
      };
      if (data && typeof data === 'object') {
        setSummary({ ...defaultSummary, ...data.summary });
        setMetaSummary(data.metaSummary || null);
      } else {
        setSummary(defaultSummary);
        setMetaSummary(null);
      }
      const now = Date.now();
      setLastSync(now);
      localStorage.setItem("last_sync_time", String(now));
    } else {
      setSummary(null);
      try {
        const err = await res.json();
        console.log('[DEBUG] Sync error response:', err);
      } catch {}
    }
    setIsSyncing(false);
  };

  const handleSyncClick = () => {
    setShowSyncConfirm(true);
  };

  const handleSaveSettings = async () => {
    setShowSettings(false);
    // Save settings to backend
    const token = localStorage.getItem("jwt_token");
    if (token) {
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const utcNotificationTime = localTimeToUTC(notificationTime, timezone);
        await fetch(`${API_URL}/api/emails/preferences`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ notificationTime: utcNotificationTime, timezone }),
        });
      } catch (err) {
        console.error('[DEBUG] Failed to save notificationTime:', err);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    setIsAuthenticated(false);
    setSummary(null);
    router.replace("/");
  };

  // Helper to generate meta description
  const getMetaDescription = () => {
    if (!summary || Object.keys(summary).length === 0) return '';
    const parts = CATEGORIES.map((cat: Category) => {
      const count = Array.isArray(summary[cat]) ? summary[cat].length : 0;
      if (count > 0) {
        return `${count} ${cat === 'goodToKnow' ? 'good to know' : cat.replace(/([A-Z])/g, ' $1').toLowerCase()} email${count > 1 ? 's' : ''}`;
      }
      return null;
    }).filter(Boolean);
    if (parts.length === 0) return 'No emails summarized.';
    return `Summary: ${parts.join(', ')}.`;
  };

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-neutral-50">
        <div className="z-10 max-w-5xl w-full items-center justify-center font-mono text-sm">
          <h1 className="text-4xl font-bold mb-4 text-center text-neutral-900">Daily Brief</h1>
          <p className="text-lg mb-8 text-center text-neutral-500 font-medium">Get the gist of your inbox, once per day.</p>
          <p className="text-xl mb-8 text-center text-neutral-600">
            Get a daily summary of your important emails, delivered right to your inbox.
          </p>
          {errorMessage && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 mb-4" role="alert">
              <p>{errorMessage}</p>
            </div>
          )}
          <div className="flex justify-center">
            <a
              href="/api/auth/google"
              className="group border border-neutral-300 px-5 py-4 transition-colors hover:border-neutral-400 hover:bg-neutral-100 text-neutral-900 font-semibold text-lg"
              style={{ borderRadius: 0 }}
            >
              Connect with Google
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated dashboard
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center p-6">
      {/* Test mode cooldown switch */}
      {TEST_MODE && (
        <div className="w-full max-w-2xl flex justify-end mb-2 gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={testModeCooldown}
              onChange={() => setTestModeCooldown(v => !v)}
              className="accent-blue-600"
            />
            24h Sync Cooldown
          </label>
          <button
            className="px-2 py-1 border border-neutral-300 text-neutral-700 bg-neutral-100 hover:bg-neutral-200 text-sm"
            style={{ borderRadius: 0 }}
            onClick={async () => {
              const token = localStorage.getItem('jwt_token');
              if (token) {
                try {
                  await fetch(`${API_URL}/api/emails/reset-sync`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                } catch {}
              }
              localStorage.removeItem('last_sync_time');
              setLastSync(null);
            }}
          >
            Reset Sync Period
          </button>
        </div>
      )}
      {/* Header */}
      <div className="w-full max-w-2xl flex flex-col items-center mb-8">
        <h1 className="text-3xl font-bold text-neutral-900 mb-1" style={{ letterSpacing: 0 }}>Daily Brief</h1>
        <p className="text-base text-neutral-500 mb-2">Get the gist of your inbox, once per day.</p>
      </div>
      {/* Main summary box with Sync Now in top left */}
      <div className="w-full max-w-2xl bg-white border border-neutral-200 relative" style={{ borderRadius: 0, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="w-full px-6 py-8">
          <div className="mb-2 text-sm text-neutral-500">
            {lastSync
              ? `Syncing emails since: ${new Date(lastSync).toLocaleString()}`
              : "Syncing emails from the last 24 hours"}
          </div>
          <div className="mb-2 text-xs text-neutral-400">
            {lastSync ? `Last sync was at: ${new Date(lastSync).toLocaleString()}` : ''}
          </div>
          {loading ? (
            <span className="text-neutral-700 text-lg">Loading...</span>
          ) : summary && Object.keys(summary).length > 0 ? (
            <div>
              {metaSummary && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded">
                  <strong>AI Summary:</strong> {metaSummary}
                </div>
              )}
              <div className="mb-6 text-neutral-700 text-base font-medium">{getMetaDescription()}</div>
              {CATEGORIES.map((cat: Category) => (
                <div key={cat} className="mb-6">
                  <button
                    className="flex items-center gap-2 mb-2 text-lg font-bold capitalize text-neutral-800 focus:outline-none"
                    onClick={() => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))}
                    aria-expanded={!collapsed[cat]}
                  >
                    <span>{cat === 'goodToKnow' ? 'Good to Know' : cat.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="text-xs text-neutral-500">{getSummaryCategory(summary, cat).length}</span>
                    <span>{collapsed[cat] ? '▼' : '▲'}</span>
                  </button>
                  {!collapsed[cat] && (
                    getSummaryCategory(summary, cat).length > 0 ? (
                      <ul className="space-y-2">
                        {getSummaryCategory(summary, cat).map((email, idx) => (
                          <li key={idx} className="border-b border-neutral-200 pb-2">
                            <div className="font-semibold text-neutral-900">{email.subject}</div>
                            <div className="text-sm text-neutral-600 mb-1">From: {email.sender}</div>
                            <div className="text-neutral-700">{email.summary}</div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-neutral-400 text-sm">No {cat === 'goodToKnow' ? 'good to know' : cat.replace(/([A-Z])/g, ' $1').toLowerCase()} emails.</div>
                    )
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-neutral-700 text-lg">No summary yet. Click &apos;Sync&apos; to fetch your email summary.</span>
          )}
        </div>
      </div>
      {/* Controls row */}
      <div className="w-full max-w-2xl flex justify-end items-center mt-4">
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 border border-neutral-300 text-neutral-700 transition hover:bg-neutral-100 cursor-pointer"
          style={{ borderRadius: 0 }}
          aria-label="Settings"
        >
          <FiSettings size={20} />
        </button>
        <button
          onClick={handleLogout}
          className="ml-2 px-4 py-2 border border-neutral-300 text-red-600 font-semibold text-base transition hover:bg-neutral-100 cursor-pointer"
          style={{ borderRadius: 0 }}
        >
          Logout
        </button>
      </div>
      {/* Sync confirmation modal */}
      {showSyncConfirm && (
        <div className="fixed inset-0 bg-neutral-200 bg-opacity-60 flex items-center justify-center z-60">
          <div className="bg-white border border-neutral-200 p-8 w-full max-w-sm" style={{ borderRadius: 0 }}>
            <h2 className="text-2xl font-bold mb-6 text-neutral-900">Manual Sync</h2>
            <div className="mb-6 text-sm text-neutral-700">
              <p className="mb-3">Daily Brief is designed to help you check your inbox less often.</p>
              <p>Are you sure you want to sync now? You won&apos;t be able to manually sync again for 24 hours.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSyncConfirm(false)}
                className="px-4 py-2 text-neutral-700 bg-neutral-100 border border-neutral-300 hover:bg-neutral-200 cursor-pointer"
                style={{ borderRadius: 0 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSync}
                className="px-4 py-2 bg-blue-600 text-white font-semibold hover:bg-blue-700 transition cursor-pointer"
                style={{ borderRadius: 0 }}
              >
                Yes, Sync Now
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-neutral-200 bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white border border-neutral-200 p-8 w-full max-w-sm" style={{ borderRadius: 0 }}>
            <h2 className="text-2xl font-bold mb-6 text-neutral-900">Preferences</h2>
            <label className="block mb-6">
              <span className="text-sm text-neutral-700">Sync & Summarize Time (Resets tomorrow)</span>
              <input
                type="time"
                value={notificationTime}
                onChange={e => setNotificationTime(e.target.value)}
                className="mt-1 block w-full border border-neutral-300 px-2 py-1 text-neutral-900"
                style={{ borderRadius: 0 }}
              />
            </label>
            <button
              onClick={canSync ? handleSyncClick : undefined}
              className={`w-full mb-4 px-4 py-2 border border-neutral-300 text-neutral-700 font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${isSyncing || !canSync ? 'bg-neutral-200 opacity-60 pointer-events-none' : 'bg-neutral-100 hover:bg-neutral-200'}`}
              style={{ borderRadius: 0 }}
              disabled={isSyncing || !canSync}
              aria-label="Sync Now"
            >
              <MdSync className={isSyncing ? "animate-spin" : ""} size={20} />
              <span>{canSync ? 'Sync Now' : `Sync in ${formatCooldown(cooldownRemaining)}`}</span>
            </button>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-neutral-700 bg-neutral-100 border border-neutral-300 hover:bg-neutral-200 cursor-pointer"
                style={{ borderRadius: 0 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-blue-600 text-white font-semibold hover:bg-blue-700 transition cursor-pointer"
                style={{ borderRadius: 0 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
