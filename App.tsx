
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NetworkStatus, Article, SyncStats, SyncConfig, Category } from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

type View = 'home' | 'sync' | 'settings' | 'reader';

const CATEGORIES: Category[] = ['Technology', 'Design', 'Future', 'Networking'];

const App: React.FC = () => {
  // --- Core State ---
  const [activeView, setActiveView] = useState<View>('home');
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
    maxStorageMb: 100,
    preferredCategories: ['Technology', 'Design', 'Future'],
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

  // --- Persistence ---
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

  const performSync = useCallback(async (manual = false) => {
    if (isProcessingRef.current) return;
    if (!manual && (network.status !== NetworkStatus.ONLINE || (config.wifiOnly && network.isMetered))) return;

    setIsSyncing(true);
    isProcessingRef.current = true;
    setSyncProgress(0);

    try {
      const remoteData = await fetchArticlesFromCloud((p) => setSyncProgress(p * 0.3));
      const filtered = remoteData.filter(a => config.preferredCategories.includes(a.category) || a.importance === 'high');

      for (let i = 0; i < filtered.length; i++) {
        await dbService.saveArticle(filtered[i]);
        setSyncProgress(30 + ((i + 1) / filtered.length) * 70);
      }
      await dbService.autoClean(config.maxStorageMb);
      await refreshUI();
    } finally {
      setIsSyncing(false);
      isProcessingRef.current = false;
      setSyncProgress(0);
    }
  }, [network, config, refreshUI]);

  useEffect(() => {
    dbService.init().then(refreshUI);
  }, [refreshUI]);

  useEffect(() => {
    if (config.autoSync && network.status === NetworkStatus.ONLINE && !isProcessingRef.current) {
      const timeout = setTimeout(performSync, 5000);
      return () => clearTimeout(timeout);
    }
  }, [network.status, config.autoSync, performSync]);

  const handleRead = async (article: Article) => {
    setSelectedArticle(article);
    setActiveView('reader');
    setAiSummary(null);
    if (config.smartSummaries && network.status !== NetworkStatus.OFFLINE) {
      setIsSummarizing(true);
      const summary = await getSmartSummary(article);
      setAiSummary(summary);
      setIsSummarizing(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- Sub-View Components ---

  const HomeView = () => (
    <div className="animate-slide-up space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-display font-black tracking-tighter text-sync-dark leading-none">Your Library</h2>
          <p className="text-slate-400 mt-3 text-lg font-medium">Smart curated content, always available.</p>
        </div>
        <div className="relative group w-full md:w-80">
          <input 
            type="text" 
            placeholder="Search offline..." 
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 px-12 text-sm font-bold focus:ring-2 focus:ring-sync-blue/10 focus:border-sync-blue transition-all outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <svg className="w-5 h-5 text-slate-300 absolute left-4 top-3.5 group-focus-within:text-sync-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {articles.length > 0 ? (
          articles.map(article => (
            <div 
              key={article.id} 
              onClick={() => handleRead(article)}
              className="group relative bg-white rounded-[2rem] border border-slate-200/60 overflow-hidden cursor-pointer hover:shadow-2xl hover:border-sync-blue/20 hover:-translate-y-2 transition-all duration-500"
            >
              <div className="aspect-[16/10] relative overflow-hidden">
                <img src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="" />
                <div className="absolute top-4 left-4 flex gap-2">
                  <span className="px-3 py-1 bg-white/90 backdrop-blur rounded-full text-[9px] font-black text-sync-dark uppercase tracking-widest shadow-sm">
                    {article.category}
                  </span>
                  {article.importance === 'high' && (
                    <div className="w-5 h-5 bg-sync-blue rounded-lg flex items-center justify-center text-white shadow-lg animate-float">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-8">
                <h3 className="text-xl font-display font-bold text-slate-900 mb-3 group-hover:text-sync-blue transition-colors line-clamp-2 leading-tight">
                  {article.title}
                </h3>
                <p className="text-slate-400 text-sm mb-6 line-clamp-2 leading-relaxed">
                  {article.excerpt}
                </p>
                <div className="flex items-center justify-between pt-6 border-t border-slate-50">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{article.author}</span>
                  <span className="font-mono text-[10px] font-bold text-sync-blue">{article.sizeKb}KB</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full py-24 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center text-slate-300 mb-6">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
            <h3 className="text-2xl font-display font-black text-slate-900">Library Empty</h3>
            <p className="text-slate-400 mt-2 max-w-xs font-medium">Connect to the stream to fill your library.</p>
          </div>
        )}
      </div>
    </div>
  );

  const SyncView = () => (
    <div className="animate-slide-up space-y-12 max-w-4xl mx-auto">
      <div className="text-center space-y-4">
        <h2 className="text-5xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Intelligence</h2>
        <p className="text-slate-400 text-lg font-medium">Live monitoring of your offline data stream.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Speed Card */}
        <div className="bg-sync-dark p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-sync-blue/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
          <div className="flex justify-between items-start mb-12">
            <div>
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Connection Quality</span>
              <div className="text-4xl font-mono font-bold">{network.speed}<span className="text-xl text-slate-500 ml-1">Mbps</span></div>
            </div>
            <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${network.status === NetworkStatus.ONLINE ? 'border-emerald-500/50 text-emerald-400' : 'border-rose-500/50 text-rose-400'}`}>
              {network.status}
            </div>
          </div>
          {/* Simulated Flow Line */}
          <div className="h-24 flex items-end gap-1.5">
            {[40, 70, 45, 90, 65, 30, 85, 55, 100, 75, 45, 80].map((h, i) => (
              <div 
                key={i} 
                className={`flex-1 rounded-full transition-all duration-1000 ${isSyncing ? 'animate-flow-gradient' : 'bg-slate-800'}`} 
                style={{ height: `${isSyncing ? h : 20}%`, transitionDelay: `${i * 100}ms` }}
              ></div>
            ))}
          </div>
        </div>

        {/* Cache Health Card */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Local Cache Health</span>
            <div className="text-4xl font-mono font-bold text-sync-dark">{stats.storageUsed}</div>
          </div>
          <div className="space-y-6 mt-12">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span>Device Quota</span>
              <span>{stats.quotaUsedPercent.toFixed(2)}% Used</span>
            </div>
            <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
              <div 
                className="h-full bg-sync-dark rounded-full transition-all duration-1000" 
                style={{ width: `${stats.quotaUsedPercent}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-10">
          <h3 className="text-xl font-display font-black text-sync-dark">Sync Activity</h3>
          <button 
            onClick={() => performSync(true)}
            disabled={isSyncing || network.status === NetworkStatus.OFFLINE}
            className="px-8 py-3 bg-sync-blue text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
          >
            {isSyncing ? 'Processing Stream...' : 'Initialize Sync'}
          </button>
        </div>

        {isSyncing ? (
          <div className="space-y-4">
             <ProgressBar progress={syncProgress} label="Downloading Article Packets" />
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">Syncing 24 priority entities from cloud node...</p>
          </div>
        ) : (
          <div className="space-y-4">
             <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-4">
                   <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                   </div>
                   <div>
                      <div className="text-sm font-black text-slate-900">Success: Global Catalog Sync</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stats.lastSync ? new Date(stats.lastSync).toLocaleString() : 'Never'}</div>
                   </div>
                </div>
                <span className="text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-widest">Completed</span>
             </div>
             <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-4">
                   <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-sync-blue">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                   </div>
                   <div>
                      <div className="text-sm font-black text-slate-900">Scheduled: Nightly Batch</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Every day at 02:00 AM</div>
                   </div>
                </div>
                <span className="text-[10px] font-mono font-bold text-slate-300 uppercase tracking-widest">Waiting</span>
             </div>
          </div>
        )}
      </div>
    </div>
  );

  const SettingsView = () => (
    <div className="animate-slide-up space-y-12 max-w-2xl mx-auto">
      <div className="text-center space-y-4">
        <h2 className="text-5xl font-display font-black tracking-tighter text-sync-dark leading-none">Settings</h2>
        <p className="text-slate-400 text-lg font-medium">Fine-tune your offline experience.</p>
      </div>

      <div className="bg-white rounded-[3rem] border border-slate-200 overflow-hidden divide-y divide-slate-100">
        <div className="p-8 flex items-center justify-between group hover:bg-slate-50 transition-colors">
          <div>
            <h4 className="text-lg font-black text-slate-900">Automatic Sync</h4>
            <p className="text-sm text-slate-400 font-medium">Allow SyncFlow to update your library automatically.</p>
          </div>
          <button 
            onClick={() => setConfig(c => ({...c, autoSync: !c.autoSync}))}
            className={`w-14 h-8 rounded-full transition-all relative ${config.autoSync ? 'bg-sync-blue shadow-lg shadow-blue-100' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${config.autoSync ? 'left-7' : 'left-1'}`}></div>
          </button>
        </div>

        <div className="p-8 flex items-center justify-between group hover:bg-slate-50 transition-colors">
          <div>
            <h4 className="text-lg font-black text-slate-900">Wi-Fi Only</h4>
            <p className="text-sm text-slate-400 font-medium">Pause sync when using metered cellular data.</p>
          </div>
          <button 
            onClick={() => setConfig(c => ({...c, wifiOnly: !c.wifiOnly}))}
            className={`w-14 h-8 rounded-full transition-all relative ${config.wifiOnly ? 'bg-emerald-500 shadow-lg shadow-emerald-100' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${config.wifiOnly ? 'left-7' : 'left-1'}`}></div>
          </button>
        </div>

        <div className="p-8 flex items-center justify-between group hover:bg-slate-50 transition-colors">
          <div>
            <h4 className="text-lg font-black text-slate-900">AI Synthesizer</h4>
            <p className="text-sm text-slate-400 font-medium">Generate intelligent summaries for every article.</p>
          </div>
          <button 
            onClick={() => setConfig(c => ({...c, smartSummaries: !c.smartSummaries}))}
            className={`w-14 h-8 rounded-full transition-all relative ${config.smartSummaries ? 'bg-sync-purple shadow-lg shadow-purple-100' : 'bg-slate-200'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${config.smartSummaries ? 'left-7' : 'left-1'}`}></div>
          </button>
        </div>

        <div className="p-8 space-y-6 group hover:bg-slate-50 transition-colors">
          <div className="flex justify-between items-center">
             <h4 className="text-lg font-black text-slate-900">Storage Cap</h4>
             <span className="font-mono text-sm font-bold text-sync-blue">{config.maxStorageMb} MB</span>
          </div>
          <input 
            type="range" 
            min="10" 
            max="500" 
            step="10"
            className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-sync-blue"
            value={config.maxStorageMb}
            onChange={(e) => setConfig(c => ({...c, maxStorageMb: Number(e.target.value)}))}
          />
        </div>

        <div className="p-8 flex items-center justify-between group hover:bg-rose-50/30 transition-colors">
          <div>
            <h4 className="text-lg font-black text-rose-600">Danger Zone</h4>
            <p className="text-sm text-slate-400 font-medium">Clear all local data and reset cache.</p>
          </div>
          <button 
            onClick={async () => { if(confirm('Wipe local database?')) { await dbService.clear(); refreshUI(); } }}
            className="px-6 py-2 bg-rose-50 text-rose-600 border border-rose-100 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all"
          >
            Wipe Cache
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background Decor */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[60%] h-[60%] blur-glow opacity-30"></div>
        <div className="absolute bottom-0 left-0 w-[50%] h-[50%] blur-glow opacity-30 rotate-180"></div>
      </div>

      {/* Global Header */}
      <header className="sticky top-0 z-[100] bg-white/70 backdrop-blur-2xl border-b border-slate-200/50 h-20">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => { setSelectedArticle(null); setActiveView('home'); }}>
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-sync-blue shadow-xl border border-slate-100 group-hover:scale-105 transition-all duration-500">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block">
               <span className="text-2xl font-display font-black tracking-tighter block leading-none">SyncFlow</span>
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mt-1 block">Data in Motion</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} />
            <div className="hidden sm:flex items-center gap-3">
               <div className={`w-3 h-3 rounded-full ${isSyncing ? 'animate-flow-gradient shadow-lg shadow-blue-200' : 'bg-slate-200'}`}></div>
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isSyncing ? 'Flowing' : 'Paused'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation (PWA Style) */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
        <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-xl px-4 py-3 rounded-[2rem] shadow-2xl flex items-center gap-2 border border-slate-700/50">
          <button 
            onClick={() => { setSelectedArticle(null); setActiveView('home'); }}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all ${activeView === 'home' ? 'bg-white text-sync-dark shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            <span className={`text-xs font-black uppercase tracking-widest ${activeView === 'home' ? 'block' : 'hidden md:block'}`}>Library</span>
          </button>
          
          <button 
            onClick={() => { setSelectedArticle(null); setActiveView('sync'); }}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all ${activeView === 'sync' ? 'bg-white text-sync-dark shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            <span className={`text-xs font-black uppercase tracking-widest ${activeView === 'sync' ? 'block' : 'hidden md:block'}`}>Intelligence</span>
          </button>
          
          <button 
            onClick={() => { setSelectedArticle(null); setActiveView('settings'); }}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl transition-all ${activeView === 'settings' ? 'bg-white text-sync-dark shadow-lg' : 'text-slate-500 hover:text-white'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span className={`text-xs font-black uppercase tracking-widest ${activeView === 'settings' ? 'block' : 'hidden md:block'}`}>Console</span>
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12 pb-32">
        {activeView === 'home' && <HomeView />}
        {activeView === 'sync' && <SyncView />}
        {activeView === 'settings' && <SettingsView />}
        {activeView === 'reader' && selectedArticle && (
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-6 duration-700">
            <button 
              onClick={() => { setSelectedArticle(null); setActiveView('home'); }}
              className="mb-8 flex items-center gap-3 text-slate-400 hover:text-slate-900 font-bold transition-all group"
            >
              <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:bg-slate-50 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              </div>
              Return Home
            </button>

            <article className="bg-white rounded-[3rem] border border-slate-200/60 overflow-hidden shadow-2xl shadow-slate-200/50">
              <div className="relative h-[450px]">
                <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                <div className="absolute bottom-12 left-12 right-12">
                  <div className="flex gap-2 mb-6">
                    <span className="px-4 py-1.5 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-[0.2em]">{selectedArticle.category}</span>
                    <span className={`px-4 py-1.5 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${selectedArticle.importance === 'high' ? 'text-sync-blue' : 'text-emerald-300'}`}>{selectedArticle.importance} PRIORITY</span>
                  </div>
                  <h1 className="text-4xl md:text-6xl font-display font-black text-white leading-tight">{selectedArticle.title}</h1>
                </div>
              </div>

              <div className="px-8 md:px-20 py-16">
                {aiSummary && (
                  <div className="mb-16 p-10 bg-gradient-to-br from-sync-blue/5 to-sync-purple/5 border border-sync-blue/10 rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 text-sync-blue/10 group-hover:scale-110 transition-transform duration-700"><svg className="w-20 h-20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg></div>
                    <div className="flex items-center gap-2 mb-6 text-sync-purple"><svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg><span className="text-[11px] font-black uppercase tracking-[0.3em]">AI Synthesis</span></div>
                    <p className="text-xl md:text-2xl font-bold text-slate-800 leading-relaxed italic pr-12">"{aiSummary}"</p>
                  </div>
                )}
                {isSummarizing && (
                  <div className="mb-16 p-10 bg-slate-50 border border-slate-100 rounded-[2.5rem] animate-pulse-soft"><div className="h-4 w-32 bg-slate-200 rounded-full mb-6"></div><div className="h-6 w-full bg-slate-200 rounded-xl mb-3"></div><div className="h-6 w-3/4 bg-slate-200 rounded-xl"></div></div>
                )}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-16 pb-12 border-b border-slate-100">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-3xl bg-slate-100 overflow-hidden shadow-xl shadow-slate-100"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedArticle.author}`} alt="" /></div>
                    <div><div className="text-xl font-black text-slate-900 leading-tight">{selectedArticle.author}</div><div className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">{selectedArticle.date}</div></div>
                  </div>
                  <div className="px-4 py-2 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center gap-2.5"><div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div><span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest leading-none">Verified Offline Access</span></div>
                </div>
                <div className="prose prose-slate prose-xl max-w-none text-slate-700 leading-relaxed space-y-10">
                  {selectedArticle.content.split('. ').map((p, i) => <p key={i} className="first-letter:text-5xl first-letter:font-black first-letter:mr-2 first-letter:text-sync-blue first-letter:float-left first-letter:mt-1">{p}.</p>)}
                </div>
              </div>
            </article>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
