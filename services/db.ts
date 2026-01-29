
import { Article } from '../types';

const DB_NAME = 'WifiSyncDB';
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
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

  async getStorageEstimate(): Promise<string> {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      if (usage === undefined) return '0 KB';
      if (usage < 1024) return `${usage} B`;
      if (usage < 1024 * 1024) return `${(usage / 1024).toFixed(1)} KB`;
      return `${(usage / (1024 * 1024)).toFixed(1)} MB`;
    }
    return 'Unknown';
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
