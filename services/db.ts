
import { Article, SyncLog, StorageCategoryBreakdown, Category } from '../types';

const DB_NAME = 'SyncFlow_Production_V2';
const STORES = {
  ARTICLES: 'articles',
  LOGS: 'sync_logs',
  METADATA: 'metadata',
  SEARCH_HISTORY: 'search_history',
  SYNC_STATE: 'sync_state'
};
const DB_VERSION = 6;

export class DatabaseService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORES.ARTICLES)) {
          const store = db.createObjectStore(STORES.ARTICLES, { keyPath: 'id' });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('version', 'version', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.LOGS)) {
          db.createObjectStore(STORES.LOGS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.SEARCH_HISTORY)) {
          db.createObjectStore(STORES.SEARCH_HISTORY, { keyPath: 'query' });
        }
        if (!db.objectStoreNames.contains(STORES.METADATA)) {
          db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.SYNC_STATE)) {
          db.createObjectStore(STORES.SYNC_STATE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async saveArticle(article: Article): Promise<void> {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction(STORES.ARTICLES, 'readwrite');
    const store = transaction.objectStore(STORES.ARTICLES);
    return new Promise((resolve, reject) => {
      const request = store.put({ ...article, cachedAt: article.cachedAt || Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllArticles(): Promise<Article[]> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.ARTICLES, 'readonly').objectStore(STORES.ARTICLES).getAll();
      request.onsuccess = () => resolve(request.result);
    });
  }

  async saveSyncState(state: any): Promise<void> {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction(STORES.SYNC_STATE, 'readwrite');
    transaction.objectStore(STORES.SYNC_STATE).put({ id: 'current', ...state });
  }

  async getSyncState(): Promise<any | null> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.SYNC_STATE, 'readonly').objectStore(STORES.SYNC_STATE).get('current');
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async clearSyncState(): Promise<void> {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction(STORES.SYNC_STATE, 'readwrite');
    transaction.objectStore(STORES.SYNC_STATE).delete('current');
  }

  async searchArticles(query: string): Promise<Article[]> {
    const all = await this.getAllArticles();
    if (!query) return all;
    const lowQuery = query.toLowerCase();
    return all.filter(a => 
      a.title.toLowerCase().includes(lowQuery) || 
      a.excerpt.toLowerCase().includes(lowQuery) ||
      a.category.toLowerCase().includes(lowQuery)
    );
  }

  async saveSearchQuery(query: string): Promise<void> {
    if (!this.db || !query.trim()) return;
    const transaction = this.db.transaction(STORES.SEARCH_HISTORY, 'readwrite');
    transaction.objectStore(STORES.SEARCH_HISTORY).put({ 
      query: query.trim(), 
      timestamp: Date.now() 
    });
  }

  async getSearchHistory(): Promise<string[]> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.SEARCH_HISTORY, 'readonly').objectStore(STORES.SEARCH_HISTORY).getAll();
      request.onsuccess = () => {
        const results = (request.result as any[])
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(r => r.query);
        const unique = Array.from(new Set(results));
        resolve(unique.slice(0, 5));
      };
    });
  }

  async getCategoryBreakdown(): Promise<StorageCategoryBreakdown[]> {
    const articles = await this.getAllArticles();
    const map: Record<string, StorageCategoryBreakdown> = {};
    articles.forEach(a => {
      if (!map[a.category]) map[a.category] = { category: a.category, sizeKb: 0, count: 0 };
      map[a.category].sizeKb += a.sizeKb;
      map[a.category].count += 1;
    });
    return Object.values(map);
  }

  async addSyncLog(log: SyncLog): Promise<void> {
    if (!this.db) await this.init();
    const transaction = this.db!.transaction(STORES.LOGS, 'readwrite');
    transaction.objectStore(STORES.LOGS).put(log);
  }

  async getSyncLogs(): Promise<SyncLog[]> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.LOGS, 'readonly').objectStore(STORES.LOGS).getAll();
      request.onsuccess = () => resolve(request.result.sort((a: SyncLog, b: SyncLog) => b.timestamp - a.timestamp));
    });
  }

  async getStorageStats() {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const used = usage || 0;
      const total = quota || 1;
      return {
        usedStr: used < 1024 * 1024 ? `${(used / 1024).toFixed(1)} KB` : `${(used / (1024 * 1024)).toFixed(1)} MB`,
        percent: (used / total) * 100,
        remainingMb: Math.max(0, (total - used) / (1024 * 1024))
      };
    }
    return { usedStr: 'Unknown', percent: 0, remainingMb: 0 };
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    const stores = [STORES.ARTICLES, STORES.LOGS, STORES.SEARCH_HISTORY, STORES.SYNC_STATE];
    const transaction = this.db!.transaction(stores, 'readwrite');
    stores.forEach(s => transaction.objectStore(s).clear());
  }
}

export const dbService = new DatabaseService();
