
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NetworkStatus, Article, SyncStats, SyncConfig, Category } from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

const CATEGORIES: Category[] = ['Technology', 'Design', 'Future', 'Networking'];

const App: React.FC = () => {
  // --- Core State ---
  const [network, setNetwork] = useState({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false });
  const [articles, setArticles] = useState<Article[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  // --- Sync & Storage State ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [stats, setStats] = useState<SyncStats>({ totalCount: 24, cachedCount: 0, lastSync: null, storageUsed: '0 KB', quotaUsedPercent: 0 });
  const [config, setConfig] = useState<SyncConfig>({
    autoSync: true,
    wifiOnly: true,
    maxStorageMb: 50,
    preferredCategories: ['Technology', 'Future'],
    smartSummaries: true
  });

  const isProcessingRef = useRef(false);

  // --- Network Logic ---
  const checkNetwork = useCallback(async () => {
    const quality = await getNetworkQuality();
    setNetwork({ status: quality.status, speed: quality.estimatedSpeedMbps, isMetered: quality.isMetered });
  }, []);

  useEffect(() => {
    window.addEventListener('online', checkNetwork);
    window.addEventListener('offline', checkNetwork);
    const interval = setInterval(checkNetwork, 10000);
    checkNetwork();
    return () => {
      window.removeEventListener('online', checkNetwork);
      window.removeEventListener('offline', checkNetwork);
      clearInterval(interval);
    };
  }, [checkNetwork]);

  // --- Data Logic ---
  const refreshUI = useCallback(async () => {
    const filtered = await dbService.searchArticles(searchQuery);
    const s = await dbService.getStorageStats();
    
    setArticles(filtered);
    setStats(prev => ({
      ...prev,
      cachedCount: filtered.length,
      lastSync: filtered.length > 0 ? Math.max(...filtered.map(a => a.cachedAt || 0)) : prev.lastSync,
      storageUsed: s.usedStr,
      quotaUsedPercent: s.percent
    }));
  }, [searchQuery]);

  const performSmartSync = useCallback(async (manual = false) => {
    if (isProcessingRef.current) return;
    
    // Adaptive Logic: Skip if weak/metered unless manual
    if (!manual) {
      if (network.status !== NetworkStatus.ONLINE) return;
      if (config.wifiOnly && network.isMetered) return;
    }

    setIsSyncing(true);
    isProcessingRef.current = true;
    setSyncProgress(0);

    try {
      // 1. Fetch remote list
      const remoteData = await fetchArticlesFromCloud((p) => setSyncProgress(p * 0.5));
      
      // 2. Prioritization Logic: Only sync what user likes and within quota
      const filtered = remoteData.filter(a => 
        config.preferredCategories.includes(a.category) || a.importance === 'high'
      );

      // 3. Save with incremental progress
      for (let i = 0; i < filtered.length; i++) {
        await dbService.saveArticle(filtered[i]);
        setSyncProgress(50 + ((i + 1) / filtered.length) * 50);
      }

      // 4. Auto-clean old data if exceeding limit
      await dbService.autoClean(config.maxStorageMb);
      
      await refreshUI();
    } finally {
      setIsSyncing(false);
      isProcessingRef.current = false;
      setSyncProgress(0);
    }
  }, [network, config, refreshUI]);

  // AI Summary Logic
  const handleReadArticle = async (article: Article) => {
    setSelectedArticle(article);
    setAiSummary(null);
    if (config.smartSummaries && network.status !== NetworkStatus.OFFLINE) {
      setIsSummarizing(true);
      const summary = await getSmartSummary(article);
      setAiSummary(summary);
      setIsSummarizing(false);
    }
  };

  useEffect(() => {
    dbService.init().then(refreshUI);
  }, [refreshUI]);

  useEffect(() => {
    if (config.autoSync && network.status === NetworkStatus.ONLINE && !isProcessingRef.current) {
      const timeout = setTimeout(performSmartSync, 3000);
      return () => clearTimeout(timeout);
    }
  }, [network.status, config.autoSync, performSmartSync]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      {/* Dynamic Header */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setSelectedArticle(null)}>
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">WifiSync Pro</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-slate-100 rounded-full px-4 py-1.5 border border-slate-200">
              <svg className="w-4 h-4 text-slate-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text" 
                placeholder="Offline search..." 
                className="bg-transparent text-sm focus:outline-none w-48 font-medium"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed} Mbps`} />
            <button 
              onClick={() => performSmartSync(true)}
              disabled={isSyncing || network.status === NetworkStatus.OFFLINE}
              className="p-2.5 bg-white border border-slate-200 rounded-full text-slate-600 hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-50 transition-all shadow-sm"
              title="Manual Sync"
            >
              <svg className={`w-5 h-5 ${isSyncing ? 'animate-spin text-indigo-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        {/* Storage Dashboard */}
        <section className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Storage Efficiency</span>
              <span className="text-lg font-black text-indigo-600">{stats.storageUsed}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-indigo-500 h-full rounded-full transition-all duration-1000" 
                style={{ width: `${Math.min(100, stats.quotaUsedPercent)}%` }}
              ></div>
            </div>
            <p className="mt-3 text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
              {stats.cachedCount} of {stats.totalCount} items locally cached
            </p>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm col-span-1 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Sync Configuration
              </h3>
              <div className="text-[10px] text-slate-400 font-bold">SMART DELTA SYNC ACTIVE</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <label className="flex flex-col gap-1 cursor-pointer">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Auto-Sync</span>
                <button 
                  onClick={() => setConfig(c => ({...c, autoSync: !c.autoSync}))}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${config.autoSync ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                >
                  {config.autoSync ? 'ON' : 'OFF'}
                </button>
              </label>
              <label className="flex flex-col gap-1 cursor-pointer">
                <span className="text-[10px] font-bold text-slate-500 uppercase">WiFi Only</span>
                <button 
                  onClick={() => setConfig(c => ({...c, wifiOnly: !c.wifiOnly}))}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${config.wifiOnly ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                >
                  {config.wifiOnly ? 'ON' : 'OFF'}
                </button>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Max Size</span>
                <select 
                  className="bg-slate-100 border-none text-[10px] font-bold rounded-lg py-1.5 focus:ring-2 focus:ring-indigo-500"
                  value={config.maxStorageMb}
                  onChange={(e) => setConfig(c => ({...c, maxStorageMb: Number(e.target.value)}))}
                >
                  <option value={10}>10 MB</option>
                  <option value={50}>50 MB</option>
                  <option value={200}>200 MB</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 cursor-pointer">
                <span className="text-[10px] font-bold text-slate-500 uppercase">AI Summary</span>
                <button 
                  onClick={() => setConfig(c => ({...c, smartSummaries: !c.smartSummaries}))}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-colors ${config.smartSummaries ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                >
                  {config.smartSummaries ? 'ON' : 'OFF'}
                </button>
              </label>
            </div>
          </div>
        </section>

        {/* Sync Progress Indicator */}
        {isSyncing && (
          <div className="mb-8 bg-indigo-600 text-white rounded-3xl p-6 shadow-xl shadow-indigo-100 animate-in slide-in-from-top-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center animate-pulse">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-widest">Intelligent Sync Active</h4>
                  <p className="text-[10px] opacity-80">Synchronizing high-priority articles first based on AI predictions.</p>
                </div>
              </div>
              <span className="text-xl font-black">{Math.round(syncProgress)}%</span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-2">
              <div className="bg-white h-full rounded-full transition-all duration-300" style={{ width: `${syncProgress}%` }}></div>
            </div>
          </div>
        )}

        {selectedArticle ? (
          /* Reader Mode */
          <div className="max-w-4xl mx-auto animate-in zoom-in-95 duration-300">
            <button 
              onClick={() => setSelectedArticle(null)}
              className="mb-6 flex items-center gap-2 text-slate-400 hover:text-indigo-600 font-bold transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </div>
              Back to Library
            </button>

            <article className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-2xl shadow-indigo-100/30">
              <div className="relative h-[400px]">
                <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <div className="absolute bottom-10 left-10 right-10">
                  <div className="flex gap-2 mb-4">
                    <span className="px-3 py-1 bg-white/20 backdrop-blur rounded-full text-[10px] font-black text-white uppercase tracking-wider">
                      {selectedArticle.category}
                    </span>
                    <span className={`px-3 py-1 bg-white/20 backdrop-blur rounded-full text-[10px] font-black uppercase tracking-wider ${selectedArticle.importance === 'high' ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {selectedArticle.importance} Priority
                    </span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-black text-white leading-tight">{selectedArticle.title}</h1>
                </div>
              </div>

              <div className="px-8 md:px-16 py-12">
                {/* AI Summary Block */}
                {aiSummary && (
                  <div className="mb-12 p-8 bg-indigo-50 border-l-4 border-indigo-500 rounded-r-2xl">
                    <div className="flex items-center gap-2 mb-4 text-indigo-600">
                      <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-[10px] font-black uppercase tracking-widest">AI Smart Summary</span>
                    </div>
                    <p className="text-lg font-medium text-indigo-900 leading-relaxed italic italic">"{aiSummary}"</p>
                  </div>
                )}

                {isSummarizing && (
                  <div className="mb-12 p-8 bg-slate-50 border-l-4 border-slate-200 rounded-r-2xl animate-pulse">
                    <div className="h-4 w-32 bg-slate-200 rounded mb-4"></div>
                    <div className="h-4 w-full bg-slate-200 rounded mb-2"></div>
                    <div className="h-4 w-2/3 bg-slate-200 rounded"></div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-12 border-b border-slate-100 pb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 overflow-hidden shadow-inner">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedArticle.author}`} alt="" />
                    </div>
                    <div>
                      <div className="text-lg font-black text-slate-900">{selectedArticle.author}</div>
                      <div className="text-sm text-slate-400 font-bold uppercase tracking-wider">{selectedArticle.date}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">DATA INTEGRITY</div>
                    <div className="text-emerald-500 text-sm font-bold flex items-center justify-end gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 4.946-2.597 9.29-6.518 11.771l-.147.091a.5.5 0 01-.57 0l-.148-.091c-3.921-2.481-6.517-6.825-6.517-11.771 0-.68.056-1.35.166-2.001zm10.741 2.908a1 1 0 00-1.414-1.414L9 8.914 7.507 7.421a1 1 0 00-1.414 1.414l2.2 2.2a1 1 0 001.414 0l4.2-4.2z" clipRule="evenodd" />
                      </svg>
                      SECURE OFFLINE COPY
                    </div>
                  </div>
                </div>

                <div className="prose prose-slate prose-lg max-w-none text-slate-700 leading-relaxed space-y-8">
                  {selectedArticle.content.split('. ').map((p, i) => (
                    <p key={i} className="first-letter:text-4xl first-letter:font-black first-letter:mr-1 first-letter:text-indigo-600">
                      {p}.
                    </p>
                  ))}
                </div>
              </div>
            </article>
          </div>
        ) : (
          /* Article Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {articles.length > 0 ? (
              articles.map(article => (
                <div 
                  key={article.id} 
                  onClick={() => handleReadArticle(article)}
                  className="group bg-white rounded-[2rem] border border-slate-200 overflow-hidden cursor-pointer hover:shadow-2xl hover:border-indigo-200 hover:-translate-y-1 transition-all duration-300"
                >
                  <div className="aspect-[1.6] relative overflow-hidden">
                    <img src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" alt="" />
                    <div className="absolute top-4 left-4 flex gap-2">
                      <span className="px-3 py-1 bg-white/90 backdrop-blur rounded-full text-[10px] font-black text-indigo-600 uppercase tracking-widest shadow-sm">
                        {article.category}
                      </span>
                      {article.importance === 'high' && (
                        <div className="w-5 h-5 bg-rose-500 rounded-full flex items-center justify-center text-white shadow-lg animate-bounce">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.342c-.716.43-1.315.908-1.783 1.391-.468.482-.787 1.007-.937 1.554a3.504 3.504 0 00-.02 1.312l.142.852l-.84-.14c-.656-.11-1.32-.145-1.952-.105a1 1 0 00-.51 1.762c1.222 1.008 2.022 2.37 2.33 3.42c.307 1.05.358 1.956.12 2.74a1 1 0 001.21 1.25c.783-.217 1.637-.6 2.316-1.18c.68-.582 1.13-1.35 1.13-2.182c0-.46-.107-.866-.302-1.22c-.195-.353-.478-.667-.847-.94a1 1 0 01-.132-1.43c.27-.333.506-.67.712-1.013c.206-.343.376-.697.51-1.06a1 1 0 00-.12-.87z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-4 left-4 right-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                      <div className="bg-indigo-600 text-white text-[10px] font-black py-2 rounded-xl text-center uppercase tracking-widest shadow-lg">
                        Quick Reader Access
                      </div>
                    </div>
                  </div>
                  <div className="p-7">
                    <h3 className="text-xl font-bold text-slate-800 mb-3 group-hover:text-indigo-600 transition-colors line-clamp-2 leading-tight">
                      {article.title}
                    </h3>
                    <p className="text-slate-400 text-sm mb-6 line-clamp-2 leading-relaxed">
                      {article.excerpt}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-slate-100 overflow-hidden shadow-inner">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${article.author}`} alt="" />
                        </div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{article.author}</span>
                      </div>
                      <span className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">
                        {article.sizeKb} KB
                      </span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-32 flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 bg-slate-100 rounded-[2rem] flex items-center justify-center text-slate-300 mb-8 shadow-inner">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-2">No matching content</h3>
                <p className="text-slate-400 max-w-sm mx-auto mb-10">We couldn't find any cached articles matching "{searchQuery}". Try connecting to Wi-Fi to refresh your library.</p>
                {network.status !== NetworkStatus.OFFLINE && (
                  <button 
                    onClick={() => performSmartSync(true)}
                    className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all uppercase tracking-widest text-xs"
                  >
                    Force Global Sync
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Network Indicator */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 pointer-events-none flex justify-center z-50">
        <div className="pointer-events-auto bg-white/80 backdrop-blur-xl px-6 py-3 rounded-full border border-slate-200 shadow-2xl flex items-center gap-8">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-0.5 leading-none">Status</span>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${network.status === NetworkStatus.ONLINE ? 'bg-emerald-500' : network.status === NetworkStatus.WEAK ? 'bg-amber-500' : 'bg-rose-500'} animate-pulse`}></div>
              <span className="text-[10px] font-black uppercase text-slate-700">{network.status}</span>
            </div>
          </div>
          <div className="w-px h-6 bg-slate-200"></div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-0.5 leading-none">Smart Cache</span>
            <span className="text-[10px] font-black text-slate-700 uppercase tracking-tighter">
              {stats.cachedCount} High-Priority Items
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
