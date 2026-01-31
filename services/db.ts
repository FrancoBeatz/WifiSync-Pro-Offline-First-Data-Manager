
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
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        Object.values(STORES).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: storeName === STORES.ARTICLES ? 'id' : storeName === STORES.SEARCH_HISTORY ? 'query' : 'id' });
            if (storeName === STORES.ARTICLES) {
              store.createIndex('category', 'category', { unique: false });
              store.createIndex('version', 'version', { unique: false });
            }
          }
        });
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });

    return this.initPromise;
  }

  async saveArticle(article: Article): Promise<void> {
    await this.init();
    const transaction = this.db!.transaction(STORES.ARTICLES, 'readwrite');
    const store = transaction.objectStore(STORES.ARTICLES);
    return new Promise((resolve, reject) => {
      const request = store.put({ ...article, cachedAt: article.cachedAt || Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllArticles(): Promise<Article[]> {
    await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.ARTICLES, 'readonly').objectStore(STORES.ARTICLES).getAll();
      request.onsuccess = () => resolve(request.result);
    });
  }

  async saveSyncState(state: any): Promise<void> {
    await this.init();
    const transaction = this.db!.transaction(STORES.SYNC_STATE, 'readwrite');
    transaction.objectStore(STORES.SYNC_STATE).put({ id: 'current', ...state });
  }

  async getSyncState(): Promise<any | null> {
    await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.SYNC_STATE, 'readonly').objectStore(STORES.SYNC_STATE).get('current');
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async clearSyncState(): Promise<void> {
    await this.init();
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
    if (!query.trim()) return;
    await this.init();
    const transaction = this.db!.transaction(STORES.SEARCH_HISTORY, 'readwrite');
    transaction.objectStore(STORES.SEARCH_HISTORY).put({ 
      query: query.trim(), 
      timestamp: Date.now() 
    });
  }

  async getSearchHistory(): Promise<string[]> {
    await this.init();
    return new Promise((resolve) => {
      const request = this.db!.transaction(STORES.SEARCH_HISTORY, 'readonly').objectStore(STORES.SEARCH_HISTORY).getAll();
      request.onsuccess = () => {
        const results = (request.result as any[])
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(r => r.query);
        resolve(Array.from(new Set(results)).slice(0, 5));
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
    await this.init();
    const transaction = this.db!.transaction(STORES.LOGS, 'readwrite');
    transaction.objectStore(STORES.LOGS).put(log);
  }

  async getSyncLogs(): Promise<SyncLog[]> {
    await this.init();
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
    await this.init();
    const stores = Object.values(STORES);
    const transaction = this.db!.transaction(stores, 'readwrite');
    stores.forEach(s => transaction.objectStore(s).clear());
  }
}

export const dbService = new DatabaseService();
