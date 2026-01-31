
import { User, UserSession } from '../types';

/**
 * Enhanced Mock Supabase client for simulated environment.
 * Persists users to localStorage to simulate a real database.
 */
const STORAGE_KEY = 'syncflow_mock_users';

const getUsers = (): any[] => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
};

const saveUsers = (users: any[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
};

export const supabase = {
  auth: {
    signUp: async ({ email, password, options }: any): Promise<{ user: User | null; error: any }> => {
      await new Promise(r => setTimeout(r, 800));
      const users = getUsers();
      
      if (users.find(u => u.email === email)) {
        return { user: null, error: { message: 'An account with this email already exists.' } };
      }

      const newUser = {
        id: `u-${Math.random().toString(36).substr(2, 9)}`,
        email,
        password, // In a real app, this would be hashed server-side by Supabase
        firstName: options.data.firstName,
        lastName: options.data.lastName,
        createdAt: new Date().toISOString(),
        isVerified: false
      };

      users.push(newUser);
      saveUsers(users);

      const user: User = {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        createdAt: newUser.createdAt
      };

      return { user, error: null };
    },

    signInWithPassword: async ({ email, password }: any): Promise<{ session: UserSession | null; error: any }> => {
      await new Promise(r => setTimeout(r, 600));
      const users = getUsers();
      const userMatch = users.find(u => u.email === email && u.password === password);

      if (!userMatch) {
        return { session: null, error: { message: 'Invalid email or password.' } };
      }

      const session: UserSession = {
        user: {
          id: userMatch.id,
          email: userMatch.email,
          firstName: userMatch.firstName,
          lastName: userMatch.lastName,
          createdAt: userMatch.createdAt
        },
        isAuthenticated: true,
        token: 'mock-jwt-token'
      };

      return { session, error: null };
    },

    resetPasswordForEmail: async (email: string): Promise<{ error: any }> => {
      await new Promise(r => setTimeout(r, 1000));
      const users = getUsers();
      const userMatch = users.find(u => u.email === email);
      
      if (!userMatch) {
        // Typically don't reveal if user exists for security, but we will return success for simulation
        return { error: null };
      }

      console.debug(`[Simulation] Password reset link sent to: ${email}`);
      return { error: null };
    },

    updateUser: async ({ password }: any): Promise<{ user: User | null; error: any }> => {
      await new Promise(r => setTimeout(r, 600));
      // In this mock, we don't track current session password update easily without more state
      return { user: null, error: null };
    },

    signOut: async (): Promise<{ error: any }> => {
      return { error: null };
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

  channel: (name: string) => ({
    on: (type: string, filter: any, callback: Function) => ({
      subscribe: () => {
        console.debug(`[Supabase Realtime] Listening on: ${name}`);
        return { unsubscribe: () => {} };
      }
    }),
    subscribe: () => {
      console.debug(`[Supabase Realtime] Channel active: ${name}`);
      return { unsubscribe: () => {} };
    }
  })
};

export const logSyncEvent = async (userId: string, details: string) => {
  console.log(`[Remote Trace] ${new Date().toISOString()} | User: ${userId} | Status: ${details}`);
};
