
import { Article } from '../types';

const DB_NAME = 'WifiSyncDB_v2';
const STORE_NAME = 'articles';
const DB_VERSION = 1;

export class DatabaseService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
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
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put({ ...article, cachedAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAllArticles(): Promise<Article[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async searchArticles(query: string): Promise<Article[]> {
    const all = await this.getAllArticles();
    if (!query) return all;
    const lowerQuery = query.toLowerCase();
    return all.filter(a => 
      a.title.toLowerCase().includes(lowerQuery) || 
      a.excerpt.toLowerCase().includes(lowerQuery) ||
      a.category.toLowerCase().includes(lowerQuery)
    );
  }

  async getStorageStats() {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const used = usage || 0;
      const total = quota || 1;
      return {
        usedStr: used < 1024 * 1024 ? `${(used / 1024).toFixed(1)} KB` : `${(used / (1024 * 1024)).toFixed(1)} MB`,
        percent: (used / total) * 100
      };
    }
    return { usedStr: 'Unknown', percent: 0 };
  }

  async autoClean(maxMb: number): Promise<number> {
    const articles = await this.getAllArticles();
    articles.sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0));
    
    let currentUsageKb = articles.reduce((sum, a) => sum + (a.sizeKb || 50), 0);
    let deletedCount = 0;

    const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    for (const article of articles) {
      if (currentUsageKb / 1024 <= maxMb) break;
      store.delete(article.id);
      currentUsageKb -= (article.sizeKb || 50);
      deletedCount++;
    }

    return deletedCount;
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      transaction.oncomplete = () => resolve();
    });
  }
}

export const dbService = new DatabaseService();
