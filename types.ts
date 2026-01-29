
export enum NetworkStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  WEAK = 'weak'
}

export type Category = 'Technology' | 'Design' | 'Future' | 'Networking';

export interface Article {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  date: string;
  imageUrl: string;
  category: Category;
  cachedAt?: number;
}

export interface SyncStats {
  totalCount: number;
  cachedCount: number;
  lastSync: number | null;
  storageUsed: string;
}

export interface NetworkInfo extends EventTarget {
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  saveData: boolean;
  onchange: EventListener;
}
