
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.39.0';
import { User, UserSession } from '../types';

// Real Supabase Client Initialization
export const supabase = createClient(
  (window as any).process?.env?.SUPABASE_URL || 'https://your-project.supabase.co',
  (window as any).process?.env?.SUPABASE_ANON_KEY || 'your-anon-key'
);

// Helper to get JWT for backend calls
export const getAuthHeader = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { 'Authorization': `Bearer ${session.access_token}` } : {};
};

export const logSyncEvent = async (userId: string, details: string) => {
  // In real backend, we call our Node API
  const headers = await getAuthHeader();
  try {
    await fetch('/api/sync/log', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'auto',
        status: 'success',
        details,
        itemsSynced: 1
      })
    });
  } catch (e) {
    console.error("Failed to log trace to backend", e);
  }
};
