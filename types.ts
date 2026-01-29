
export enum NetworkStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  WEAK = 'weak'
}

export type Category = 'Technology' | 'Design' | 'Future' | 'Networking';
export type Importance = 'high' | 'medium' | 'low';

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
}

export interface SyncStats {
  totalCount: number;
  cachedCount: number;
  lastSync: number | null;
  storageUsed: string;
  quotaUsedPercent: number;
}

export interface NetworkQuality {
  status: NetworkStatus;
  effectiveType: string;
  estimatedSpeedMbps: number;
  isMetered: boolean;
}

export interface NetworkInfo extends EventTarget {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  saveData: boolean;
  onchange: EventListener;
}

export interface SyncConfig {
  autoSync: boolean;
  wifiOnly: boolean;
  maxStorageMb: number;
  preferredCategories: Category[];
  smartSummaries: boolean;
}
