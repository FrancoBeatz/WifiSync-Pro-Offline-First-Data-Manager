
import { Article, UserSession } from '../types';

// In a real app, you'd use createClient(URL, KEY) from @supabase/supabase-js
// We mock it here to ensure the "SyncFlow" logic works seamlessly.
export const supabase = {
  auth: {
    signIn: async (email: string): Promise<UserSession> => {
      await new Promise(r => setTimeout(r, 800));
      return {
        user: { id: 'user-123', email, name: email.split('@')[0] },
        isAuthenticated: true
      };
    },
    signOut: async () => {
      return { user: null, isAuthenticated: false };
    }
  },
  from: (table: string) => ({
    select: () => ({
      order: () => ({
        data: [],
        error: null
      })
    }),
    upsert: async (data: any) => ({ data, error: null })
  }),
  /**
   * Mock channel method for realtime telemetry.
   * Fixed: Added direct subscribe method to support App.tsx usage: supabase.channel(name).subscribe()
   */
  channel: (name: string) => ({
    on: (type: string, filter: any, callback: Function) => ({
      subscribe: () => {
        console.log(`Subscribed to Supabase Realtime: ${name}`);
        return { unsubscribe: () => {} };
      }
    }),
    subscribe: () => {
      console.log(`Subscribed to Supabase Realtime: ${name}`);
      return { unsubscribe: () => {} };
    }
  })
};

export const logSyncEvent = async (userId: string, details: string) => {
  console.log(`[Supabase Remote Log] User: ${userId} | ${details}`);
};
