
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  NetworkStatus, Article, SyncStats, SyncConfig, Category, SyncStatus, 
  UserSession, SyncLog, Conflict, Importance, DownloadState, OfflineSessionState 
} from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import { supabase, logSyncEvent } from './services/supabase';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

type View = 'auth' | 'home' | 'sync' | 'settings' | 'reader';

const App: React.FC = () => {
  // --- Core States ---
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  const [activeView, setActiveView] = useState<View>('auth');
  const [network, setNetwork] = useState({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false, signalStrength: 100 });
  const [articles, setArticles] = useState<Article[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  
  // --- Engine States ---
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [offlineState, setOfflineState] = useState<OfflineSessionState>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [stats, setStats] = useState<SyncStats>({ 
    totalCount: 24, 
    cachedCount: 0, 
    lastSync: null, 
    storageUsed: '0 KB', 
    quotaUsedPercent: 0,
    transferSpeed: 0,
    categoryBreakdown: [],
    remainingDataSizeKb: 0,
    etaSeconds: 0
  });
  
  const [downloadBuffer, setDownloadBuffer] = useState<Article[]>([]);
  const [config, setConfig] = useState<SyncConfig>({
    autoSync: true,
    wifiOnly: true,
    maxStorageMb: 250,
    preferredCategories: ['Technology', 'Design', 'Future', 'Networking'],
    categoryPriorities: {
      'Technology': 'high',
      'Design': 'medium',
      'Future': 'medium',
      'Networking': 'low'
    },
    smartSummaries: true,
    retryAttempts: 3
  });

  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);

  // --- Network Logic ---
  const checkNetwork = useCallback(async () => {
    const q = await getNetworkQuality();
    setNetwork({ status: q.status, speed: q.estimatedSpeedMbps, isMetered: q.isMetered, signalStrength: q.signalStrength });

    // Auto-Pause Logic
    if (isDownloadingRef.current) {
      // Fix: Removed redundant check for NetworkStatus.WEAK as it is already captured by q.status !== NetworkStatus.ONLINE
      if (q.status !== NetworkStatus.ONLINE || (config.wifiOnly && q.isMetered)) {
        setDownloadState('paused');
        isDownloadingRef.current = false;
        if (session.user) logSyncEvent(session.user.id, "Auto-paused download due to network degradation.");
      }
    } else if (downloadState === 'paused' && q.status === NetworkStatus.ONLINE && (!config.wifiOnly || !q.isMetered)) {
       // Fix: Removed redundant check q.status !== NetworkStatus.WEAK because if q.status === NetworkStatus.ONLINE, it cannot be WEAK
       handleStartDownload();
    }
  }, [config.wifiOnly, downloadState, session.user]);

  useEffect(() => {
    window.addEventListener('online', checkNetwork);
    window.addEventListener('offline', checkNetwork);
    const interval = setInterval(checkNetwork, 3000);
    checkNetwork();
    return () => {
      window.removeEventListener('online', checkNetwork);
      window.removeEventListener('offline', checkNetwork);
      clearInterval(interval);
    };
  }, [checkNetwork]);

  // --- Data Flow ---
  const refreshUI = useCallback(async () => {
    const items = await dbService.searchArticles(searchQuery);
    const logsData = await dbService.getSyncLogs();
    const history = await dbService.getSearchHistory();
    const storage = await dbService.getStorageStats();
    const breakdown = await dbService.getCategoryBreakdown();
    
    setArticles(items);
    setLogs(logsData);
    setSearchHistory(history);
    setStats(prev => ({
      ...prev,
      cachedCount: items.length,
      lastSync: logsData[0]?.timestamp || prev.lastSync,
      storageUsed: storage.usedStr,
      quotaUsedPercent: storage.percent,
      categoryBreakdown: breakdown
    }));
  }, [searchQuery]);

  useEffect(() => {
    dbService.init().then(refreshUI);
  }, [refreshUI]);

  // --- Auth & Search ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = (e.target as any).email.value;
    const s = await supabase.auth.signIn(email);
    setSession(s);
    setActiveView('home');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    dbService.saveSearchQuery(searchQuery);
    refreshUI();
  };

  // --- Download Controls ---
  const handleStartDownload = async () => {
    if (downloadState === 'downloading') return;
    if (network.status !== NetworkStatus.ONLINE) return;

    setDownloadState('downloading');
    isDownloadingRef.current = true;

    try {
      if (downloadIdxRef.current === 0) {
        const local = await dbService.getAllArticles();
        const remote = await fetchArticlesFromCloud();
        
        // Priority Sorting & Version Check
        const filtered = remote
          .filter(a => config.preferredCategories.includes(a.category))
          .sort((a, b) => {
            const pA = config.categoryPriorities[a.category];
            const pB = config.categoryPriorities[b.category];
            const map: Record<Importance, number> = { high: 3, medium: 2, low: 1 };
            return map[pB] - map[pA];
          });

        const updatesNeeded = filtered.filter(rem => {
          const loc = local.find(l => l.id === rem.id);
          return !loc || rem.version > loc.version;
        });

        downloadSourceRef.current = updatesNeeded;
        setStats(s => ({ ...s, remainingDataSizeKb: updatesNeeded.reduce((acc, a) => acc + a.sizeKb, 0) }));
      }

      const syncLoop = async () => {
        if (!isDownloadingRef.current) return;
        if (downloadIdxRef.current >= downloadSourceRef.current.length) {
          setDownloadState('completed');
          isDownloadingRef.current = false;
          return;
        }

        const article = downloadSourceRef.current[downloadIdxRef.current];
        const delay = Math.random() * 600 + 400;
        await new Promise(r => setTimeout(r, delay));

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        setSyncProgress((downloadIdxRef.current / downloadSourceRef.current.length) * 100);

        // Telemetry
        const speed = article.sizeKb / (delay / 1000);
        const remKb = downloadSourceRef.current.slice(downloadIdxRef.current).reduce((acc, a) => acc + a.sizeKb, 0);
        setStats(s => ({ ...s, transferSpeed: speed, remainingDataSizeKb: remKb, etaSeconds: remKb / speed }));

        if (isDownloadingRef.current) syncLoop();
      };
      syncLoop();
    } catch (e) {
      setDownloadState('stopped');
      isDownloadingRef.current = false;
    }
  };

  const handleStopDownload = () => {
    setDownloadState('stopped');
    isDownloadingRef.current = false;
    downloadIdxRef.current = 0;
    setDownloadBuffer([]);
    setSyncProgress(0);
  };

  const handleSaveData = async () => {
    setDownloadState('saving');
    const local = await dbService.getAllArticles();
    const newConflicts: Conflict[] = [];

    for (const article of downloadBuffer) {
      const loc = local.find(l => l.id === article.id);
      if (loc?.hasLocalChanges) {
        newConflicts.push({ local: loc, remote: article });
      } else {
        await dbService.saveArticle(article);
      }
    }

    setConflicts(prev => [...prev, ...newConflicts]);
    await dbService.addSyncLog({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'manual',
      status: 'success',
      details: `Saved ${downloadBuffer.length - newConflicts.length} articles. ${newConflicts.length} conflicts.`,
      itemsSynced: downloadBuffer.length
    });

    setDownloadBuffer([]);
    downloadIdxRef.current = 0;
    setSyncProgress(0);
    setDownloadState('idle');
    refreshUI();
  };

  const resolveConflict = async (conflict: Conflict, choice: 'local' | 'remote') => {
    if (choice === 'remote') {
      await dbService.saveArticle(conflict.remote);
    } else {
      await dbService.saveArticle({ ...conflict.local, hasLocalChanges: false });
    }
    setConflicts(prev => prev.filter(c => c.local.id !== conflict.local.id));
    refreshUI();
  };

  // --- Sub-Views ---
  const ConflictBanner = () => conflicts.length > 0 && (
    <div className="bg-amber-50 border border-amber-200 rounded-[2.5rem] p-8 mb-12 animate-slide-up">
       <div className="flex items-center gap-4 text-amber-700 mb-6">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <h3 className="text-xl font-display font-black tracking-tight">Version Collision ({conflicts.length})</h3>
       </div>
       <div className="space-y-4">
          {conflicts.map(c => (
            <div key={c.local.id} className="bg-white p-5 rounded-3xl border border-amber-100 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm">
               <div className="text-slate-900 font-bold text-sm">{c.local.title}</div>
               <div className="flex gap-3">
                  <button onClick={() => resolveConflict(c, 'local')} className="px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-colors">Keep Local</button>
                  <button onClick={() => resolveConflict(c, 'remote')} className="px-6 py-2.5 bg-sync-blue text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:shadow-lg transition-all">Apply Update</button>
               </div>
            </div>
          ))}
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sync-light flex flex-col">
      {/* Dynamic Header */}
      <header className="sticky top-0 z-[100] bg-white/70 backdrop-blur-2xl border-b border-slate-200/50 h-20">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setActiveView('home')}>
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-sync-blue shadow-xl border border-slate-100 group-hover:scale-110 transition-all duration-500">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block">
               <span className="text-2xl font-display font-black tracking-tighter block leading-none">SyncFlow</span>
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mt-1 block">Production V4.0</span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <NetworkStatusBadge 
              status={network.status} 
              effectiveType={`${network.speed}Mbps`} 
              signalStrength={network.signalStrength}
              isMetered={network.isMetered}
            />
            <div className="w-10 h-10 rounded-xl bg-slate-100 overflow-hidden border border-slate-200">
               <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email || 'guest'}`} alt="" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-12 pb-32">
        {activeView === 'auth' && (
           <div className="min-h-[70vh] flex items-center justify-center">
              <form onSubmit={handleLogin} className="w-full max-w-md bg-white p-12 rounded-[3.5rem] shadow-2xl animate-slide-up border border-slate-100">
                 <div className="flex flex-col items-center mb-12 text-center">
                    <div className="w-24 h-24 bg-sync-blue rounded-[2.5rem] flex items-center justify-center text-white mb-6 shadow-2xl shadow-blue-100"><svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
                    <h1 className="text-5xl font-display font-black tracking-tighter">SyncFlow</h1>
                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[11px] mt-2">Intelligence Authentication</p>
                 </div>
                 <div className="space-y-6">
                    <input name="email" type="email" required placeholder="operator@syncflow.io" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-8 py-5 font-bold focus:ring-4 focus:ring-sync-blue/10 outline-none transition-all" />
                    <button type="submit" className="w-full bg-sync-blue text-white py-6 rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-blue-100 hover:scale-105 active:scale-95 transition-all">Initialize Stream</button>
                 </div>
              </form>
           </div>
        )}

        {activeView === 'home' && (
          <div className="animate-slide-up">
            <ConflictBanner />
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
              <div>
                <h2 className="text-6xl font-display font-black tracking-tighter text-sync-dark leading-none">Knowledge Core</h2>
                <p className="text-slate-400 mt-5 text-2xl font-medium">Synced intelligence ready for offline execution.</p>
              </div>
              <div className="relative group w-full md:w-96">
                <form onSubmit={handleSearch}>
                  <input 
                    type="text" 
                    placeholder="Filter packets..." 
                    className="w-full bg-white border border-slate-200 rounded-[2rem] py-5 px-16 text-sm font-bold focus:ring-4 focus:ring-sync-blue/5 focus:border-sync-blue transition-all outline-none shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </form>
                <svg className="w-6 h-6 text-slate-300 absolute left-6 top-5 group-focus-within:text-sync-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                {searchQuery === '' && searchHistory.length > 0 && (
                   <div className="absolute top-full left-0 right-0 mt-4 bg-white/95 backdrop-blur-xl rounded-3xl border border-slate-200 shadow-2xl p-3 z-[70] animate-slide-up">
                      <div className="px-5 py-2 text-[9px] font-black text-slate-300 uppercase tracking-widest mb-2 border-b border-slate-50">Recent Streams</div>
                      {searchHistory.map(h => (
                         <button key={h} onClick={() => { setSearchQuery(h); refreshUI(); }} className="w-full text-left px-5 py-3.5 hover:bg-slate-50 rounded-2xl text-xs font-bold text-slate-600 flex items-center gap-3 transition-colors">
                            <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {h}
                         </button>
                      ))}
                   </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
              {articles.map(article => (
                <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[3rem] border border-slate-200/60 overflow-hidden cursor-pointer hover:shadow-[0_48px_80px_-24px_rgba(0,0,0,0.08)] hover:-translate-y-3 transition-all duration-500">
                  <div className="aspect-[16/11] relative overflow-hidden">
                    <img src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="" />
                    <div className="absolute top-6 left-6 px-4 py-2 bg-white/90 backdrop-blur rounded-full text-[10px] font-black text-sync-dark uppercase tracking-[0.2em] shadow-sm">{article.category}</div>
                  </div>
                  <div className="p-10">
                    <h3 className="text-2xl font-display font-bold text-slate-900 mb-5 group-hover:text-sync-blue transition-colors line-clamp-2 leading-[1.2]">{article.title}</h3>
                    <p className="text-slate-400 text-sm mb-10 line-clamp-2 leading-relaxed font-medium">{article.excerpt}</p>
                    <div className="flex items-center justify-between pt-8 border-t border-slate-50">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{article.author}</span>
                       <span className="font-mono text-xs font-bold text-sync-blue">{article.sizeKb}KB • V{article.version}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeView === 'sync' && (
           <div className="animate-slide-up space-y-12 max-w-5xl mx-auto">
              <div className="text-center space-y-5 mb-20">
                 <h2 className="text-7xl font-display font-black tracking-tighter text-sync-dark">Sync Console</h2>
                 <p className="text-slate-400 text-2xl font-medium">Live data telemetry and stream management.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                 <div className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-sm space-y-10">
                    <div className="flex items-center justify-between">
                       <h3 className="text-2xl font-display font-black text-sync-dark">Download Engine</h3>
                       <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>{downloadState}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                       <button onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} className="flex flex-col items-center justify-center gap-3 py-6 bg-sync-blue text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-xl shadow-blue-100 disabled:opacity-30 disabled:scale-100"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>Start Stream</button>
                       <button onClick={() => { isDownloadingRef.current = false; setDownloadState('paused'); }} disabled={downloadState !== 'downloading'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-50 text-slate-600 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-100 transition-all disabled:opacity-30"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Pause</button>
                       <button onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} className="flex flex-col items-center justify-center gap-3 py-6 bg-rose-50 text-rose-600 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-rose-100 transition-all disabled:opacity-30"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>Cancel</button>
                       <button onClick={handleSaveData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} className="flex flex-col items-center justify-center gap-3 py-6 bg-emerald-50 text-emerald-600 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] hover:bg-emerald-100 transition-all shadow-lg shadow-emerald-50 disabled:opacity-30"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>Commit ({downloadBuffer.length})</button>
                    </div>
                    {downloadState !== 'idle' && (
                       <div className="pt-8 border-t border-slate-50"><ProgressBar progress={syncProgress} label="Packet Streaming" speed={stats.transferSpeed} eta={stats.etaSeconds} remainingKb={stats.remainingDataSizeKb} /></div>
                    )}
                 </div>

                 <div className="bg-sync-dark p-12 rounded-[3.5rem] text-white shadow-2xl flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-12 opacity-5"><svg className="w-40 h-40" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
                    <div className="relative z-10">
                       <h3 className="text-2xl font-display font-black mb-8">Offline Deployment</h3>
                       <p className="text-slate-400 text-lg leading-relaxed mb-12">Activate offline session to utilize cached intelligence. All modifications will be queued for the next uplink.</p>
                       <button onClick={() => setOfflineState(s => s === 'active' ? 'stopped' : 'active')} className={`w-full py-6 rounded-[2rem] text-xs font-black uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-4 ${offlineState === 'active' ? 'bg-rose-500 text-white' : 'bg-white text-sync-dark shadow-2xl'}`}>{offlineState === 'active' ? 'Shutdown Session' : 'Enter Offline Mode'}</button>
                    </div>
                    <div className="mt-16 flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-500">
                       <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${offlineState === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'}`} />{stats.cachedCount} Packets on Disk</div>
                       <span className="font-mono text-sync-blue">LATENCY: 0.00ms</span>
                    </div>
                 </div>
              </div>

              <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
                 <div className="flex items-center justify-between mb-12">
                    <h3 className="text-3xl font-display font-black text-sync-dark">Storage Analysis</h3>
                    <div className="text-right"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Disk Usage</span><span className="text-3xl font-mono font-bold text-sync-blue leading-none">{stats.storageUsed}</span></div>
                 </div>
                 <div className="space-y-8">
                    {stats.categoryBreakdown.map(b => (
                       <div key={b.category} className="group">
                          <div className="flex justify-between items-center mb-4">
                             <div className="flex items-center gap-4"><div className="w-3 h-3 rounded-full bg-sync-blue shadow-lg shadow-blue-200" /><span className="text-sm font-black uppercase tracking-[0.2em] text-slate-900">{b.category}</span></div>
                             <div className="flex items-center gap-5"><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{b.count} entities</span><span className="font-mono text-sm font-bold text-slate-900">{(b.sizeKb / 1024).toFixed(1)}MB</span></div>
                          </div>
                          <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden"><div className="h-full bg-slate-200 group-hover:bg-sync-blue transition-all duration-700" style={{ width: `${(b.sizeKb / (config.maxStorageMb * 10.24)) * 100}%` }} /></div>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        )}

        {activeView === 'settings' && (
           <div className="animate-slide-up max-w-4xl mx-auto">
              <div className="text-center space-y-5 mb-20">
                 <h2 className="text-7xl font-display font-black tracking-tighter text-sync-dark">Flow Configuration</h2>
                 <p className="text-slate-400 text-2xl font-medium">Fine-tune the intelligence engine.</p>
              </div>

              <div className="bg-white rounded-[4rem] border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                 <div className="p-12 space-y-8">
                    <div className="flex justify-between items-center">
                       <h4 className="text-2xl font-black text-slate-900">Synchronizer Rule-Set</h4>
                       <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Weights for Delta Sync</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                       {(['Technology', 'Design', 'Future', 'Networking'] as Category[]).map(cat => (
                         <div key={cat} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between hover:border-sync-blue/30 transition-all">
                            <span className="text-sm font-black text-slate-700 uppercase tracking-widest">{cat}</span>
                            <select value={config.categoryPriorities[cat]} onChange={(e) => setConfig(c => ({ ...c, categoryPriorities: { ...c.categoryPriorities, [cat]: e.target.value as Importance } }))} className="bg-white border border-slate-200 text-[10px] font-black uppercase rounded-xl px-4 py-2 outline-none focus:ring-4 focus:ring-sync-blue/5">
                               <option value="high">High priority</option>
                               <option value="medium">Medium</option>
                               <option value="low">Low priority</option>
                            </select>
                         </div>
                       ))}
                    </div>
                 </div>

                 <div className="p-12 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <div><h4 className="text-2xl font-black text-slate-900 mb-2">Strict Wi-Fi Protocol</h4><p className="text-slate-400 font-medium text-base">Interrupt stream immediately if switching to cellular.</p></div>
                    <button onClick={() => setConfig(c => ({ ...c, wifiOnly: !c.wifiOnly }))} className={`w-20 h-10 rounded-full transition-all relative ${config.wifiOnly ? 'bg-emerald-500' : 'bg-slate-200'}`}><div className={`absolute top-1.5 w-7 h-7 bg-white rounded-full transition-all shadow-md ${config.wifiOnly ? 'left-11.5' : 'left-1.5'}`} /></button>
                 </div>

                 <div className="p-12 space-y-10">
                    <div className="flex justify-between items-end"><h4 className="text-2xl font-black text-slate-900">System Storage Quota</h4><span className="font-mono text-3xl font-bold text-sync-blue leading-none">{config.maxStorageMb}MB</span></div>
                    <input type="range" min="100" max="1000" step="50" className="w-full h-4 bg-slate-100 rounded-full appearance-none cursor-pointer accent-sync-blue" value={config.maxStorageMb} onChange={(e) => setConfig(c => ({ ...c, maxStorageMb: Number(e.target.value) }))} />
                 </div>

                 <div className="p-12 flex items-center justify-between bg-rose-50/20 group">
                    <div><h4 className="text-2xl font-black text-rose-600 mb-2">Destructive Reset</h4><p className="text-slate-400 font-medium">Flush the Knowledge Core and wipe all local identity.</p></div>
                    <button onClick={async () => { if(confirm('Flush Knowledge Core?')) { await dbService.clear(); refreshUI(); } }} className="px-12 py-5 bg-rose-50 text-rose-600 border border-rose-100 rounded-3xl font-black uppercase tracking-[0.2em] text-xs hover:bg-rose-600 hover:text-white transition-all shadow-sm">Execute Wipe</button>
                 </div>
              </div>
           </div>
        )}

        {activeView === 'reader' && selectedArticle && (
           <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-700">
              <button onClick={() => setActiveView('home')} className="mb-12 flex items-center gap-4 text-slate-400 hover:text-slate-900 font-bold transition-all group">
                 <div className="w-12 h-12 rounded-[1.5rem] bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:bg-slate-50 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg></div>
                 Return to Core
              </button>
              <article className="bg-white rounded-[4rem] border border-slate-200/60 overflow-hidden shadow-2xl relative">
                 <div className="relative h-[600px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
                    <div className="absolute bottom-20 left-20 right-20">
                       <div className="flex gap-4 mb-10">
                          <span className="px-6 py-2.5 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-xs font-black text-white uppercase tracking-[0.3em]">{selectedArticle.category}</span>
                          <span className={`px-6 py-2.5 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-xs font-black uppercase tracking-[0.3em] ${selectedArticle.importance === 'high' ? 'text-sync-blue' : 'text-emerald-300'}`}>Priority: {selectedArticle.importance}</span>
                       </div>
                       <h1 className="text-6xl md:text-8xl font-display font-black text-white leading-[1.02] tracking-tight">{selectedArticle.title}</h1>
                    </div>
                 </div>
                 <div className="px-10 md:px-32 py-24">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-12 mb-24 pb-20 border-b border-slate-100">
                       <div className="flex items-center gap-8">
                          <div className="w-24 h-24 rounded-[2.5rem] bg-slate-100 overflow-hidden border border-slate-100 shadow-2xl shadow-slate-200/50"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedArticle.author}`} alt="" /></div>
                          <div><div className="text-3xl font-black text-slate-900 leading-tight">{selectedArticle.author}</div><div className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-2">{selectedArticle.date}</div></div>
                       </div>
                       <div className="px-8 py-4 bg-emerald-50 rounded-3xl border border-emerald-100 flex items-center gap-4"><div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" /><span className="text-xs font-black text-emerald-700 uppercase tracking-[0.2em] leading-none">Local Decryption Ready</span></div>
                    </div>
                    <div className="prose prose-slate prose-2xl max-w-none text-slate-700 leading-[1.7] space-y-16">
                       {selectedArticle.content.split('. ').map((p, i) => <p key={i} className="first-letter:text-8xl first-letter:font-black first-letter:mr-5 first-letter:text-sync-blue first-letter:float-left first-letter:mt-2">{p}.</p>)}
                    </div>
                 </div>
              </article>
           </div>
        )}
      </main>

      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
        <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-6 py-5 rounded-[3rem] shadow-2xl flex items-center gap-4 border border-slate-700/50">
          <button onClick={() => { setSelectedArticle(null); setActiveView('home'); }} className={`flex items-center gap-4 px-10 py-4 rounded-[2rem] transition-all duration-500 ${activeView === 'home' ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white'}`}>
             <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
             <span className={`text-xs font-black uppercase tracking-[0.3em] ${activeView === 'home' ? 'block' : 'hidden'}`}>Core</span>
          </button>
          <button onClick={() => { setSelectedArticle(null); setActiveView('sync'); }} className={`flex items-center gap-4 px-10 py-4 rounded-[2rem] transition-all duration-500 ${activeView === 'sync' ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white'}`}>
             <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
             <span className={`text-xs font-black uppercase tracking-[0.3em] ${activeView === 'sync' ? 'block' : 'hidden'}`}>Sync</span>
          </button>
          <button onClick={() => { setSelectedArticle(null); setActiveView('settings'); }} className={`flex items-center gap-4 px-10 py-4 rounded-[2rem] transition-all duration-500 ${activeView === 'settings' ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white'}`}>
             <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
             <span className={`text-xs font-black uppercase tracking-[0.3em] ${activeView === 'settings' ? 'block' : 'hidden'}`}>Admin</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
