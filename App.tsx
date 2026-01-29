
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NetworkStatus, Article, SyncStats, SyncConfig, Category } from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

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

  // --- Data Persistence ---
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
      const remoteData = await fetchArticlesFromCloud((p) => setSyncProgress(p * 0.4));
      
      const filtered = remoteData.filter(a => 
        config.preferredCategories.includes(a.category) || a.importance === 'high'
      );

      for (let i = 0; i < filtered.length; i++) {
        await dbService.saveArticle(filtered[i]);
        setSyncProgress(40 + ((i + 1) / filtered.length) * 60);
      }

      await dbService.autoClean(config.maxStorageMb);
      await refreshUI();
    } finally {
      setIsSyncing(false);
      isProcessingRef.current = false;
      setSyncProgress(0);
    }
  }, [network, config, refreshUI]);

  const handleReadArticle = async (article: Article) => {
    setSelectedArticle(article);
    setAiSummary(null);
    if (config.smartSummaries && network.status !== NetworkStatus.OFFLINE) {
      setIsSummarizing(true);
      const summary = await getSmartSummary(article);
      setAiSummary(summary);
      setIsSummarizing(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    <div className="min-h-screen flex flex-col bg-[#F8FAFC]">
      {/* SyncFlow Navigation */}
      <nav className="sticky top-0 z-[60] bg-white/70 backdrop-blur-2xl border-b border-slate-200/60 h-20">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setSelectedArticle(null)}>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-[#0B5FFF] to-[#7B61FF] rounded-2xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity"></div>
              <div className="relative w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-[#0B5FFF] shadow-xl border border-slate-100 group-hover:scale-105 transition-transform duration-500">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <div>
              <span className="text-2xl font-black tracking-tighter block leading-none">SyncFlow</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mt-1 block">Smart. Offline. Flow.</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden lg:flex items-center bg-slate-100/50 rounded-full px-5 py-2.5 border border-slate-200/50 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <svg className="w-4 h-4 text-slate-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input 
                type="text" 
                placeholder="Search cached data..." 
                className="bg-transparent text-sm focus:outline-none w-56 font-bold text-slate-600 placeholder:text-slate-300"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed} Mbps`} />
            <button 
              onClick={() => performSmartSync(true)}
              disabled={isSyncing || network.status === NetworkStatus.OFFLINE}
              className={`p-3 rounded-2xl border transition-all ${
                isSyncing 
                ? 'bg-blue-50 border-blue-100 text-[#0B5FFF]' 
                : 'bg-white border-slate-200 text-slate-500 hover:text-[#0B5FFF] hover:border-blue-200 hover:shadow-lg hover:shadow-blue-50'
              }`}
            >
              <svg className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12">
        {/* SyncFlow Hero Dashboard */}
        {!selectedArticle && (
          <section className="mb-16 grid grid-cols-1 xl:grid-cols-4 gap-8">
            {/* Sync Progress Card */}
            <div className={`col-span-1 xl:col-span-2 relative overflow-hidden bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm transition-all duration-700 ${isSyncing ? 'ring-2 ring-blue-500 shadow-xl shadow-blue-100' : ''}`}>
              {isSyncing && (
                <div className="absolute top-0 left-0 w-full h-1 animate-flow opacity-60"></div>
              )}
              <div className="flex justify-between items-start mb-10">
                <div>
                  <h3 className="text-lg font-black tracking-tight mb-1">Live Synchronizer</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{isSyncing ? 'Intelligent data transfer in progress' : 'Library is up to date'}</p>
                </div>
                {isSyncing && <div className="font-mono-stats text-2xl font-black text-[#0B5FFF]">{Math.round(syncProgress)}%</div>}
              </div>
              
              <div className="space-y-6">
                <ProgressBar progress={isSyncing ? syncProgress : 100} label={isSyncing ? 'Active Flow' : 'Last Sync: ' + (stats.lastSync ? new Date(stats.lastSync).toLocaleTimeString() : 'Never')} />
                <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-blue-500 animate-ping' : 'bg-slate-200'}`}></div>
                    {isSyncing ? 'Transferring Packets' : 'System Dormant'}
                  </div>
                  <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                  <div>Estimated Time: {isSyncing ? '12s' : '0s'}</div>
                </div>
              </div>
            </div>

            {/* Storage Usage Card */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 block mb-1">Local Footprint</span>
                <span className="font-mono-stats text-3xl font-black text-slate-900 leading-none">{stats.storageUsed}</span>
              </div>
              <div className="mt-8">
                <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                  <span>Quota Used</span>
                  <span>{stats.quotaUsedPercent.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-900 rounded-full transition-all duration-1000" style={{ width: `${stats.quotaUsedPercent}%` }}></div>
                </div>
              </div>
            </div>

            {/* Smart Controls Card */}
            <div className="bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl shadow-slate-200 text-white flex flex-col justify-between">
              <div className="flex items-center justify-between mb-6">
                <h4 className="text-sm font-black uppercase tracking-widest text-slate-500">Auto-Flow</h4>
                <button 
                  onClick={() => setConfig(c => ({...c, autoSync: !c.autoSync}))}
                  className={`w-12 h-6 rounded-full transition-all relative ${config.autoSync ? 'bg-[#0B5FFF]' : 'bg-slate-700'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.autoSync ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>
              <p className="text-xs font-bold leading-relaxed text-slate-400">
                SyncFlow intelligently schedules updates when connection is optimal.
              </p>
              <div className="mt-6 flex gap-2">
                <button 
                  onClick={() => setConfig(c => ({...c, wifiOnly: !c.wifiOnly}))}
                  className={`flex-1 text-[9px] font-black py-2.5 rounded-xl border transition-all ${config.wifiOnly ? 'border-emerald-500/50 text-emerald-400' : 'border-slate-700 text-slate-500'}`}
                >
                  WIFI ONLY: {config.wifiOnly ? 'ON' : 'OFF'}
                </button>
                <button 
                  onClick={() => setConfig(c => ({...c, smartSummaries: !c.smartSummaries}))}
                  className={`flex-1 text-[9px] font-black py-2.5 rounded-xl border transition-all ${config.smartSummaries ? 'border-[#7B61FF]/50 text-[#7B61FF]' : 'border-slate-700 text-slate-500'}`}
                >
                  AI SUMMARY
                </button>
              </div>
            </div>
          </section>
        )}

        {selectedArticle ? (
          /* Reader Mode */
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700">
            <button 
              onClick={() => setSelectedArticle(null)}
              className="mb-8 flex items-center gap-3 text-slate-400 hover:text-slate-900 font-bold transition-all group"
            >
              <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:bg-slate-50 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
              </div>
              Back to Library
            </button>

            <article className="bg-white rounded-[3rem] border border-slate-200/60 overflow-hidden shadow-2xl shadow-slate-200/50">
              <div className="relative h-[450px]">
                <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                <div className="absolute bottom-12 left-12 right-12">
                  <div className="flex gap-2 mb-6">
                    <span className="px-4 py-1.5 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-[0.2em]">
                      {selectedArticle.category}
                    </span>
                    <span className={`px-4 py-1.5 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${selectedArticle.importance === 'high' ? 'text-blue-300' : 'text-emerald-300'}`}>
                      {selectedArticle.importance} PRIORITY
                    </span>
                  </div>
                  <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-[1.1]">{selectedArticle.title}</h1>
                </div>
              </div>

              <div className="px-8 md:px-20 py-16">
                {/* AI Summary Block */}
                {aiSummary && (
                  <div className="mb-16 p-10 bg-gradient-to-br from-indigo-50/50 to-blue-50/50 border border-indigo-100 rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 text-indigo-200/50 group-hover:scale-110 transition-transform duration-700">
                      <svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                      </svg>
                    </div>
                    <div className="flex items-center gap-2 mb-6 text-[#7B61FF]">
                      <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-[11px] font-black uppercase tracking-[0.3em]">AI Synthesis</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-slate-800 leading-relaxed italic pr-12">
                      "{aiSummary}"
                    </p>
                  </div>
                )}

                {isSummarizing && (
                  <div className="mb-16 p-10 bg-slate-50 border border-slate-100 rounded-[2.5rem] animate-pulse-soft">
                    <div className="h-4 w-32 bg-slate-200 rounded-full mb-6"></div>
                    <div className="h-6 w-full bg-slate-200 rounded-xl mb-3"></div>
                    <div className="h-6 w-3/4 bg-slate-200 rounded-xl"></div>
                  </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-16 pb-12 border-b border-slate-100">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-3xl bg-slate-100 overflow-hidden shadow-xl shadow-slate-100">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedArticle.author}`} alt="" />
                    </div>
                    <div>
                      <div className="text-xl font-black text-slate-900 leading-tight">{selectedArticle.author}</div>
                      <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">{selectedArticle.date}</div>
                    </div>
                  </div>
                  <div className="flex flex-col md:items-end">
                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-2">Sync Signature</div>
                    <div className="px-4 py-2 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center gap-2.5">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest leading-none">Verified Offline Access</span>
                    </div>
                  </div>
                </div>

                <div className="prose prose-slate prose-xl max-w-none text-slate-700 leading-relaxed space-y-10">
                  {selectedArticle.content.split('. ').map((p, i) => (
                    <p key={i} className="first-letter:text-5xl first-letter:font-black first-letter:mr-2 first-letter:text-[#0B5FFF] first-letter:float-left first-letter:mt-1">
                      {p}.
                    </p>
                  ))}
                </div>
              </div>
            </article>
          </div>
        ) : (
          /* Article Feed Grid */
          <div className="space-y-10">
            <div className="flex items-center justify-between">
              <h2 className="text-4xl font-black tracking-tighter">Your Library</h2>
              <div className="hidden sm:flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 bg-blue-500 rounded-sm"></div>
                  High Priority
                </div>
                <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 bg-slate-200 rounded-sm"></div>
                  Standard
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
              {articles.length > 0 ? (
                articles.map(article => (
                  <div 
                    key={article.id} 
                    onClick={() => handleReadArticle(article)}
                    className="group bg-white rounded-[2.5rem] border border-slate-200/60 overflow-hidden cursor-pointer hover:shadow-[0_32px_64px_-16px_rgba(11,95,255,0.08)] hover:border-blue-200 hover:-translate-y-2 transition-all duration-500 card-fill"
                  >
                    <div className="aspect-[16/11] relative overflow-hidden">
                      <img src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="" />
                      <div className="absolute top-5 left-5 flex gap-2">
                        <span className="px-4 py-1.5 bg-white/90 backdrop-blur-xl rounded-full text-[10px] font-black text-slate-800 uppercase tracking-widest shadow-xl shadow-black/5">
                          {article.category}
                        </span>
                        {article.importance === 'high' && (
                          <div className="w-6 h-6 bg-[#0B5FFF] rounded-xl flex items-center justify-center text-white shadow-lg animate-bounce">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.342c-.716.43-1.315.908-1.783 1.391-.468.482-.787 1.007-.937 1.554a3.504 3.504 0 00-.02 1.312l.142.852l-.84-.14c-.656-.11-1.32-.145-1.952-.105a1 1 0 00-.51 1.762c1.222 1.008 2.022 2.37 2.33 3.42c.307 1.05.358 1.956.12 2.74a1 1 0 001.21 1.25c.783-.217 1.637-.6 2.316-1.18c.68-.582 1.13-1.35 1.13-2.182c0-.46-.107-.866-.302-1.22c-.195-.353-.478-.667-.847-.94a1 1 0 01-.132-1.43c.27-.333.506-.67.712-1.013c.206-.343.376-.697.51-1.06a1 1 0 00-.12-.87z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                      <div className="absolute bottom-6 left-6 right-6 translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500">
                        <div className="bg-[#0B5FFF] text-white text-[10px] font-black py-3 rounded-2xl text-center uppercase tracking-[0.2em] shadow-2xl">
                          SyncFlow Access
                        </div>
                      </div>
                    </div>
                    <div className="p-8">
                      <h3 className="text-xl font-black text-slate-900 mb-4 group-hover:text-[#0B5FFF] transition-colors line-clamp-2 leading-[1.2]">
                        {article.title}
                      </h3>
                      <p className="text-slate-400 text-sm mb-8 line-clamp-2 leading-relaxed font-medium">
                        {article.excerpt}
                      </p>
                      <div className="flex items-center justify-between pt-6 border-t border-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 overflow-hidden border border-slate-200">
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${article.author}`} alt="" />
                          </div>
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{article.author}</span>
                        </div>
                        <span className="font-mono-stats text-[10px] font-bold text-slate-300">
                          {article.sizeKb}KB
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full py-40 flex flex-col items-center justify-center text-center">
                  <div className="relative mb-10">
                    <div className="absolute inset-0 bg-blue-100 blur-3xl rounded-full"></div>
                    <div className="relative w-28 h-28 bg-white rounded-[2.5rem] flex items-center justify-center text-slate-300 shadow-xl border border-slate-100">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-3xl font-black text-slate-900 mb-4">Flowing Empty</h3>
                  <p className="text-slate-400 max-w-sm mx-auto mb-12 text-lg font-medium">Connect to the stream to fill your library with intelligence for your offline journey.</p>
                  {network.status !== NetworkStatus.OFFLINE && (
                    <button 
                      onClick={() => performSmartSync(true)}
                      className="px-12 py-5 bg-[#0B5FFF] text-white rounded-[2rem] font-black shadow-2xl shadow-blue-200 hover:scale-105 active:scale-95 transition-all uppercase tracking-[0.2em] text-xs"
                    >
                      Initialize Sync Stream
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating Network Intelligence */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
        <div className="pointer-events-auto bg-white/80 backdrop-blur-2xl px-10 py-5 rounded-full border border-slate-200/60 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] flex items-center gap-10">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-1.5 leading-none">Stream</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${network.status === NetworkStatus.ONLINE ? 'bg-emerald-500' : network.status === NetworkStatus.WEAK ? 'bg-amber-500' : 'bg-rose-500'} animate-pulse`}></div>
              <span className="text-[10px] font-black uppercase text-slate-800 tracking-widest">{network.status}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-slate-200"></div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em] mb-1.5 leading-none">Intelligence</span>
            <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">
              {stats.cachedCount} Packets Buffered
            </span>
          </div>
          {isSyncing && (
            <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
               <div className="w-1.5 h-1.5 bg-[#0B5FFF] rounded-full animate-ping"></div>
               <span className="text-[9px] font-black text-[#0B5FFF] uppercase tracking-[0.2em]">Flowing</span>
            </div>
          )}
        </div>
      </div>

      {/* Background Decor */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-50 blur-[150px] opacity-40 rounded-full"></div>
        <div className="absolute bottom-[-5%] left-[-5%] w-[40%] h-[40%] bg-indigo-50 blur-[120px] opacity-40 rounded-full"></div>
      </div>
    </div>
  );
};

export default App;
