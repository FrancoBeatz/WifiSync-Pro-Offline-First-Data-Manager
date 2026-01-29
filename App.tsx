
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NetworkStatus, Article, NetworkInfo, SyncStats } from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

const App: React.FC = () => {
  // --- State ---
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(NetworkStatus.ONLINE);
  const [effectiveType, setEffectiveType] = useState<string>('4g');
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [stats, setStats] = useState<SyncStats>({ totalCount: 0, cachedCount: 0, lastSync: null, storageUsed: '0 KB' });
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  // --- Refs ---
  const isSyncingRef = useRef<boolean>(false);

  // --- 1. Network Logic ---
  const updateNetworkStatus = useCallback(() => {
    const isOnline = navigator.onLine;
    const connection = (navigator as any).connection as NetworkInfo;

    let status = NetworkStatus.ONLINE;
    if (!isOnline) {
      status = NetworkStatus.OFFLINE;
    } else if (connection && (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g' || connection.effectiveType === '3g')) {
      status = NetworkStatus.WEAK;
    }

    setNetworkStatus(status);
    if (connection) setEffectiveType(connection.effectiveType);
  }, []);

  useEffect(() => {
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    const connection = (navigator as any).connection as NetworkInfo;
    if (connection) connection.addEventListener('change', updateNetworkStatus);

    updateNetworkStatus();

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      if (connection) connection.removeEventListener('change', updateNetworkStatus);
    };
  }, [updateNetworkStatus]);

  // --- 2. Data Persistence ---
  const refreshLocalData = useCallback(async () => {
    const cached = await dbService.getAllArticles();
    const storage = await dbService.getStorageEstimate();
    
    setArticles(cached);
    setStats({
      totalCount: 24, // Known total from our mock
      cachedCount: cached.length,
      lastSync: cached.length > 0 ? Math.max(...cached.map(a => a.cachedAt || 0)) : null,
      storageUsed: storage
    });
  }, []);

  const performSync = useCallback(async (manual = false) => {
    if (isSyncingRef.current) return;
    
    // Safety check: Don't auto-sync on weak signals to save user data/battery
    if (!manual && (networkStatus === NetworkStatus.WEAK || networkStatus === NetworkStatus.OFFLINE)) return;
    if (manual && networkStatus === NetworkStatus.OFFLINE) return;

    setIsDownloading(true);
    isSyncingRef.current = true;
    setDownloadProgress(0);

    try {
      const remoteData = await fetchArticlesFromCloud((p) => setDownloadProgress(p));
      
      // Save items one by one to simulate partial completion
      for (let i = 0; i < remoteData.length; i++) {
        await dbService.saveArticle(remoteData[i]);
      }
      
      await refreshLocalData();
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setIsDownloading(false);
      isSyncingRef.current = false;
      setDownloadProgress(0);
    }
  }, [networkStatus, refreshLocalData]);

  // --- 3. Initial Load ---
  useEffect(() => {
    const init = async () => {
      await dbService.init();
      await refreshLocalData();
    };
    init();
  }, [refreshLocalData]);

  // --- 4. Auto-Sync Logic ---
  useEffect(() => {
    if (autoSyncEnabled && networkStatus === NetworkStatus.ONLINE && !isSyncingRef.current) {
      performSync();
    }
  }, [networkStatus, autoSyncEnabled, performSync]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setSelectedArticle(null)}>
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-indigo-200 shadow-lg">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-xl font-black text-gray-900 hidden sm:block">WifiSync Pro</span>
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
              <NetworkStatusBadge status={networkStatus} effectiveType={effectiveType} />
              
              <button
                onClick={() => performSync(true)}
                disabled={isDownloading || networkStatus === NetworkStatus.OFFLINE}
                className={`relative inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all shadow-md active:scale-95 ${
                  isDownloading || networkStatus === NetworkStatus.OFFLINE
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-200'
                }`}
              >
                <svg className={`w-4 h-4 ${isDownloading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden xs:inline">{isDownloading ? 'Syncing...' : 'Sync'}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Progress Display */}
        {isDownloading && (
          <div className="mb-8 bg-white rounded-2xl p-6 border border-indigo-100 shadow-sm animate-pulse-slow">
            <ProgressBar progress={downloadProgress} label="Downloading secure data packets..." />
            <div className="mt-3 flex items-center gap-2 text-xs text-indigo-500 font-semibold">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></div>
              {networkStatus === NetworkStatus.WEAK ? "Low bandwidth detected. Prioritizing critical data." : "Optimizing storage for offline access."}
            </div>
          </div>
        )}

        {/* Selected Article View */}
        {selectedArticle ? (
          <div className="bg-white rounded-3xl overflow-hidden border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="relative h-64 sm:h-96">
              <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
              <button 
                onClick={() => setSelectedArticle(null)}
                className="absolute top-6 left-6 w-12 h-12 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center text-gray-800 shadow-lg hover:bg-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
            <div className="max-w-3xl mx-auto px-6 sm:px-12 py-10">
              <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase tracking-widest">{selectedArticle.category}</span>
                <span className="text-gray-400 text-sm">•</span>
                <span className="text-gray-500 text-sm">{selectedArticle.date}</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-gray-900 leading-tight mb-6">
                {selectedArticle.title}
              </h1>
              <div className="flex items-center gap-4 mb-10 pb-10 border-b border-gray-100">
                <div className="w-12 h-12 bg-gray-200 rounded-full overflow-hidden">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedArticle.author}`} alt={selectedArticle.author} />
                </div>
                <div>
                  <div className="font-bold text-gray-900">{selectedArticle.author}</div>
                  <div className="text-sm text-gray-500">Senior Technical Writer</div>
                </div>
              </div>
              <div className="prose prose-indigo max-w-none text-gray-700 leading-relaxed space-y-6 text-lg">
                {selectedArticle.content.split('. ').map((para, i) => (
                  <p key={i}>{para}.</p>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Article Grid */
          <div className="space-y-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">Your Offline Library</h2>
                <p className="text-gray-500 mt-2 text-lg">Content synced automatically when you're on a strong Wi-Fi connection.</p>
              </div>
              {networkStatus === NetworkStatus.OFFLINE && (
                <div className="px-4 py-2 bg-amber-50 text-amber-700 rounded-lg border border-amber-200 flex items-center gap-2 text-sm font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Viewing cached data
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {articles.length > 0 ? (
                articles.map(article => (
                  <div 
                    key={article.id} 
                    onClick={() => setSelectedArticle(article)}
                    className="group bg-white rounded-2xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-2xl hover:border-indigo-100 transition-all duration-300"
                  >
                    <div className="aspect-[16/10] overflow-hidden relative">
                      <img src={article.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="" />
                      <div className="absolute top-4 left-4">
                        <span className="px-3 py-1 bg-white/90 backdrop-blur text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm">
                          {article.category}
                        </span>
                      </div>
                    </div>
                    <div className="p-6">
                      <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-indigo-600 transition-colors line-clamp-2">
                        {article.title}
                      </h3>
                      <p className="text-gray-500 text-sm mb-6 line-clamp-2 leading-relaxed">
                        {article.excerpt}
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-100 overflow-hidden">
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${article.author}`} alt="" />
                          </div>
                          <span className="text-xs font-bold text-gray-700">{article.author}</span>
                        </div>
                        <div className="text-[10px] font-black text-gray-300 flex items-center gap-1 uppercase">
                          <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Stored
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full py-24 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center text-gray-300 mb-6">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">Your library is empty</h3>
                  <p className="text-gray-500 max-w-xs mx-auto mt-2 mb-8">Connect to Wi-Fi or sync manually to download content for offline use.</p>
                  {networkStatus !== NetworkStatus.OFFLINE && (
                    <button 
                      onClick={() => performSync(true)}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                    >
                      Start First Sync
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer Stats */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex gap-4 sm:gap-8 items-center text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-widest">
            <div className="flex flex-col">
              <span className="text-gray-300 mb-0.5">Last Sync</span>
              <span className="text-gray-900">{stats.lastSync ? new Date(stats.lastSync).toLocaleTimeString() : '---'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-300 mb-0.5">Local Storage</span>
              <span className="text-gray-900">{stats.storageUsed}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-300 mb-0.5">Cache Status</span>
              <span className="text-gray-900">{stats.cachedCount}/{stats.totalCount} Articles</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Auto-Sync</span>
              <button 
                onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                className={`w-11 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${autoSyncEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-200 ${autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'}`}></div>
              </button>
            </div>
            <button 
              onClick={async () => {
                if (confirm('Are you sure you want to delete all cached content?')) {
                  await dbService.clear();
                  await refreshLocalData();
                }
              }}
              className="p-2 text-gray-300 hover:text-red-500 transition-colors"
              title="Clear all offline data"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
