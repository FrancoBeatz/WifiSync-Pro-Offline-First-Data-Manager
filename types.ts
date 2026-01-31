
export enum NetworkStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  WEAK = 'weak'
}

export type Category = 'Technology' | 'Design' | 'Future' | 'Networking';
export type Importance = 'high' | 'medium' | 'low';
export type SyncStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'success';
export type DownloadState = 'idle' | 'downloading' | 'paused' | 'stopped' | 'completed' | 'saving';
export type OfflineSessionState = 'active' | 'paused' | 'stopped' | 'idle';

export interface NetworkQuality {
  status: NetworkStatus;
  effectiveType: string;
  estimatedSpeedMbps: number;
  isMetered: boolean;
  signalStrength: number; // 0 to 100
}

export interface NetworkInfo {
  saveData: boolean;
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
}

export interface Article {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  date: string;
  imageUrl: string;
  category: Category;
  importance: Importance;
  sizeKb: number;
  cachedAt?: number;
  version: number;
  hasLocalChanges?: boolean;
}

export interface SyncLog {
  id: string;
  timestamp: number;
  type: 'auto' | 'manual';
  status: 'success' | 'failed';
  details: string;
  itemsSynced: number;
}

export interface StorageCategoryBreakdown {
  category: Category;
  sizeKb: number;
  count: number;
}

export interface SyncStats {
  totalCount: number;
  cachedCount: number;
  lastSync: number | null;
  storageUsed: string;
  quotaUsedPercent: number;
  transferSpeed: number; // KB/s
  categoryBreakdown: StorageCategoryBreakdown[];
  remainingDataSizeKb: number;
  etaSeconds: number;
}

export interface SyncConfig {
  autoSync: boolean;
  wifiOnly: boolean;
  maxStorageMb: number;
  preferredCategories: Category[];
  categoryPriorities: Record<Category, Importance>;
  smartSummaries: boolean;
  retryAttempts: number;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface UserSession {
  user: User | null;
  isAuthenticated: boolean;
  token?: string;
}

export interface Conflict {
  local: Article;
  remote: Article;
}
