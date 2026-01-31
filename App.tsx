
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  NetworkStatus, Article, SyncStats, SyncConfig, Category, SyncStatus, 
  UserSession, SyncLog, DownloadState, OfflineSessionState, User
} from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import { supabase, logSyncEvent } from './services/supabase';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

type View = 'auth' | 'home' | 'library' | 'settings' | 'reader';
type AuthView = 'login' | 'register' | 'forgot-password';

const App: React.FC = () => {
  // --- Core State Management ---
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  const [activeView, setActiveView] = useState<View>('auth');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [network, setNetwork] = useState({ 
    status: NetworkStatus.ONLINE, 
    speed: 10, 
    isMetered: false, 
    signalStrength: 100,
    effectiveType: '4g' 
  });
  
  // --- Data States ---
  const [articles, setArticles] = useState<Article[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({});
  
  // --- Feedback States ---
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);
  
  // --- Sync Engine States ---
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [offlineState, setOfflineState] = useState<OfflineSessionState>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [downloadBuffer, setDownloadBuffer] = useState<Article[]>([]);
  const [stats, setStats] = useState<SyncStats>({ 
    totalCount: 0, cachedCount: 0, lastSync: null, storageUsed: '0 KB', 
    quotaUsedPercent: 0, transferSpeed: 0, categoryBreakdown: [],
    remainingDataSizeKb: 0, etaSeconds: 0
  });

  // --- Configuration ---
  const [config, setConfig] = useState<SyncConfig>({
    autoSync: true,
    wifiOnly: true,
    maxStorageMb: 2000,
    preferredCategories: ['Technology', 'Design', 'Future', 'Networking'],
    categoryPriorities: { 'Technology': 'high', 'Design': 'medium', 'Future': 'medium', 'Networking': 'low' },
    smartSummaries: true,
    retryAttempts: 5,
    autoPauseWeak: true,
    autoResume: true,
    backgroundSync: false,
    syncPriority: 'normal',
    connectivitySensitivity: 'balanced',
    meteredProtection: true,
    autoDeleteOld: false,
    autoDeleteDurationDays: 30,
    encryptOffline: false,
    sessionTimeoutMinutes: 60,
    debugMode: false
  });

  // --- Engine Refs (Critical for stability and avoiding re-renders) ---
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const networkRef = useRef(network);
  const downloadStateRef = useRef<DownloadState>('idle');
  const configRef = useRef(config);
  const isDbReady = useRef(false);

  useEffect(() => { networkRef.current = network; }, [network]);
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);
  useEffect(() => { configRef.current = config; }, [config]);

  // --- Database Initialization (Runs once) ---
  useEffect(() => {
    const init = async () => {
      if (isDbReady.current) return;
      await dbService.init();
      isDbReady.current = true;
      refreshUI();
    };
    init();
  }, []);

  // --- UI Refresh Action (Throttled/Controlled) ---
  const refreshUI = useCallback(async (query: string = searchQuery) => {
    if (!isDbReady.current) return;
    try {
      const items = await dbService.searchArticles(query);
      const logsData = await dbService.getSyncLogs();
      const storage = await dbService.getStorageStats();
      const breakdown = await dbService.getCategoryBreakdown();
      
      setArticles(items);
      setLogs(logsData);
      setStats(prev => ({
        ...prev,
        cachedCount: items.length,
        lastSync: logsData[0]?.timestamp || prev.lastSync,
        storageUsed: storage.usedStr,
        quotaUsedPercent: storage.percent,
        categoryBreakdown: breakdown
      }));
    } catch (err) {
      console.error("UI Refresh Error:", err);
    }
  }, [searchQuery]);

  // Refresh data when search query changes (Debounced effect)
  useEffect(() => {
    const timeout = setTimeout(() => {
      refreshUI();
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, refreshUI]);

  // --- Sync Engine Handlers ---
  const handleStartDownload = useCallback(async () => {
    if (isDownloadingRef.current) return;
    if (networkRef.current.status === NetworkStatus.OFFLINE) {
      setErrorMsg("Uplink required for synchronization.");
      return;
    }

    setDownloadState('downloading');
    isDownloadingRef.current = true;
    setErrorMsg(null);

    try {
      if (downloadIdxRef.current === 0 || !downloadSourceRef.current.length) {
        const remote = await fetchArticlesFromCloud();
        const local = await dbService.getAllArticles();
        downloadSourceRef.current = remote.filter(rem => {
          const loc = local.find(l => l.id === rem.id);
          return !loc || rem.version > loc.version;
        });
        if (!downloadSourceRef.current.length) {
          setDownloadState('completed');
          isDownloadingRef.current = false;
          return;
        }
      }

      const syncLoop = async () => {
        if (!isDownloadingRef.current) return;
        if (downloadIdxRef.current >= downloadSourceRef.current.length) {
          setDownloadState('completed');
          isDownloadingRef.current = false;
          return;
        }

        const article = downloadSourceRef.current[downloadIdxRef.current];
        const signal = networkRef.current.signalStrength;
        const sensitivityMult = configRef.current.connectivitySensitivity === 'low' ? 0.5 : configRef.current.connectivitySensitivity === 'high' ? 1.5 : 1.0;
        const baseSpeed = (100 + (signal / 100) * 8000) * sensitivityMult;
        const delay = (article.sizeKb / baseSpeed) * 1000;

        await new Promise(r => setTimeout(r, Math.max(10, delay)));
        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        
        // Progress update
        const progress = (downloadIdxRef.current / downloadSourceRef.current.length) * 100;
        setSyncProgress(progress);
        
        // Throttled stats update to prevent jitter
        if (downloadIdxRef.current % 5 === 0 || downloadIdxRef.current === downloadSourceRef.current.length) {
          setStats(prev => ({
            ...prev,
            transferSpeed: baseSpeed / 1024,
            remainingDataSizeKb: downloadSourceRef.current.slice(downloadIdxRef.current).reduce((acc, a) => acc + a.sizeKb, 0)
          }));
        }

        syncLoop();
      };
      
      syncLoop();
    } catch (e) {
      console.error("Download failure", e);
      setDownloadState('paused');
      isDownloadingRef.current = false;
    }
  }, []);

  const handlePauseDownload = useCallback(() => {
    isDownloadingRef.current = false;
    setDownloadState('paused');
  }, []);

  const handleStopDownload = useCallback(() => {
    isDownloadingRef.current = false;
    setDownloadState('stopped');
    downloadIdxRef.current = 0;
    setSyncProgress(0);
    setDownloadBuffer([]);
    downloadSourceRef.current = [];
  }, []);

  const handleSaveData = async () => {
    if (downloadBuffer.length === 0) return;
    setDownloadState('saving');
    const itemsCount = downloadBuffer.length;
    for (const art of downloadBuffer) {
      await dbService.saveArticle(art);
    }

    await dbService.addSyncLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: 'manual',
      status: 'success',
      details: `Bridged ${itemsCount} items to local hub.`,
      itemsSynced: itemsCount
    });

    setDownloadBuffer([]);
    downloadIdxRef.current = 0;
    setSyncProgress(0);
    setDownloadState('idle');
    await dbService.clearSyncState();
    refreshUI();
  };

  const handleClearCache = async () => {
    if (window.confirm("Perform hard-reset on local cache? This cannot be undone.")) {
      await dbService.clear();
      await dbService.addSyncLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: 'manual',
        status: 'success',
        details: 'Local intelligence core manually flushed.',
        itemsSynced: 0
      });
      refreshUI();
    }
  };

  const handleSummarize = async (article: Article) => {
    if (summaries[article.id] || loadingSummaries[article.id]) return;
    setLoadingSummaries(prev => ({ ...prev, [article.id]: true }));
    try {
      const summary = await getSmartSummary(article);
      setSummaries(prev => ({ ...prev, [article.id]: summary }));
    } catch (e) {
      console.error("AI Summary generation failed", e);
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [article.id]: false }));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthLoading(true);
    const formData = new FormData(e.target as HTMLFormElement);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const { session: userSession, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (userSession) {
        setSession(userSession);
        setActiveView('home');
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Credential verification failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthSuccessMsg(null);
    const formData = new FormData(e.target as HTMLFormElement);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;

    if (password !== confirmPassword) return setErrorMsg("Passwords do not match.");
    
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ 
        email, 
        password, 
        options: { data: { firstName, lastName } } 
      });
      if (error) throw error;
      setAuthSuccessMsg("Account provisioned successfully. Please login.");
      setAuthView('login');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession({ user: null, isAuthenticated: false });
    setActiveView('auth');
    setDownloadState('idle');
    handleStopDownload();
  };

  const toggleConfig = (key: keyof SyncConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateConfig = (key: keyof SyncConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // --- Connectivity Watcher (Stabilized) ---
  useEffect(() => {
    const watcher = async () => {
      const q = await getNetworkQuality();
      
      setNetwork(prev => {
        const hasStatusChanged = prev.status !== q.status || prev.signalStrength !== q.signalStrength || prev.effectiveType !== q.effectiveType;
        if (!hasStatusChanged) return prev;

        // Auto-pause logic
        if (isDownloadingRef.current && configRef.current.autoPauseWeak) {
          const isWeak = q.status === NetworkStatus.WEAK || q.signalStrength < 25;
          const isMeteredRestricted = configRef.current.wifiOnly && q.isMetered;
          if (q.status === NetworkStatus.OFFLINE || isWeak || isMeteredRestricted) {
            handlePauseDownload();
          }
        } 
        // Auto-resume logic
        else if (downloadStateRef.current === 'paused' && configRef.current.autoResume) {
          const isStrong = q.status === NetworkStatus.ONLINE && q.signalStrength > 60;
          const isWifiEligible = !configRef.current.wifiOnly || !q.isMetered;
          if (isStrong && isWifiEligible) {
            handleStartDownload();
          }
        }

        return q;
      });
    };
    
    const interval = setInterval(watcher, 3000);
    return () => clearInterval(interval);
  }, [handlePauseDownload, handleStartDownload]);

  // --- Views ---

  const HomeSyncView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h1>
        <p className="text-slate-400 text-2xl font-medium">Manage cloud-to-local data bridging.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-10">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black text-sync-dark">Uplink Control</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              {downloadState}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <SyncActionButton onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} label="Download via Wi-Fi" variant="blue" />
            <SyncActionButton onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} label="Pause Download" variant="slate" />
            <SyncActionButton onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} label="Stop Stream" variant="rose" />
            <SyncActionButton onClick={handleSaveData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} label={`Save Data (${downloadBuffer.length})`} variant="emerald" />
          </div>

          {(downloadState !== 'idle' || syncProgress > 0) && (
            <div className="pt-8 border-t border-slate-50">
              <ProgressBar progress={syncProgress} label={`Streaming Activity: ${downloadState}`} speed={downloadState === 'downloading' ? (stats.transferSpeed || 0) * 1024 : 0} remainingKb={stats.remainingDataSizeKb} />
            </div>
          )}
        </div>

        <div className="bg-sync-dark p-10 rounded-[3rem] text-white shadow-2xl space-y-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-3xl font-display font-black">Offline Workspace</h3>
              <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-slate-700 ${offlineState === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500'}`}>{offlineState}</div>
            </div>
            <p className="text-slate-400 text-lg font-medium opacity-80 mb-10">Access locally cached packets and queue modifications for sync.</p>
            
            <div className="grid grid-cols-2 gap-4">
              <SyncActionButton onClick={() => setOfflineState('active')} disabled={offlineState === 'active'} label="Enter Offline Mode" variant="white" />
              <SyncActionButton onClick={() => setOfflineState('paused')} disabled={offlineState !== 'active'} label="Pause Session" variant="dark" />
              <SyncActionButton onClick={() => setOfflineState('idle')} disabled={offlineState === 'idle'} label="End Session" variant="dark" />
              <SyncActionButton onClick={() => alert("Changes cached locally.")} disabled={offlineState !== 'active'} label="Commit Changes" variant="dark" />
            </div>
          </div>
          <div className="pt-8 border-t border-slate-800 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            <span>{stats.cachedCount} Packets Indexed</span>
            <span className="font-mono text-sync-blue">IO Latency: 0.1ms</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
          <h3 className="text-2xl font-display font-black text-sync-dark mb-8">Uplink Telemetry</h3>
          <div className="grid grid-cols-2 gap-8">
            <TelemetryItem label="Effective Type" value={network.effectiveType.toUpperCase()} />
            <TelemetryItem label="Measured Throughput" value={`${network.speed} Mbps`} />
            <TelemetryItem label="Metered Link" value={network.isMetered ? 'Yes' : 'No'} color={network.isMetered ? 'text-amber-500' : 'text-emerald-500'} />
            <TelemetryItem label="Signal Strength" value={`${network.signalStrength}%`} />
          </div>
        </div>
        
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
           <h3 className="text-2xl font-display font-black text-sync-dark mb-8">System Events</h3>
           <div className="space-y-4 max-h-56 overflow-y-auto pr-4 custom-scrollbar">
             {logs.slice(0, 10).map(log => (
               <div key={log.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                 <div className="flex flex-col">
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{new Date(log.timestamp).toLocaleTimeString()}</span>
                   <span className="text-xs font-bold text-slate-800 truncate max-w-[200px]">{log.details}</span>
                 </div>
                 <div className={`w-2 h-2 rounded-full ${log.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
               </div>
             ))}
           </div>
        </div>
      </div>
    </div>
  );

  const LibraryView = () => (
    <div className="animate-slide-up space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-4">
          <h2 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Knowledge</h2>
          <p className="text-slate-400 text-2xl font-medium uppercase tracking-widest opacity-60">{stats.cachedCount} Packets locally verified</p>
        </div>
        <div className="relative w-full md:w-96 group">
          <input type="text" placeholder="Search knowledge..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border-2 border-slate-50 rounded-3xl py-5 px-10 text-lg font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none shadow-lg transition-all" />
          <svg className="w-6 h-6 text-slate-300 absolute right-8 top-1/2 -translate-y-1/2 group-focus-within:text-sync-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {articles.map(article => (
          <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[3.5rem] border border-slate-100 overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-500 hover:-translate-y-2">
            <div className="aspect-[16/10] relative overflow-hidden">
              <img src={article.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="cover" />
              <div className="absolute top-8 left-8 px-4 py-2 bg-white/90 backdrop-blur-lg rounded-xl text-[10px] font-black text-sync-dark uppercase tracking-widest shadow-sm">{article.category}</div>
            </div>
            <div className="p-10 space-y-6">
              <h3 className="text-2xl font-display font-black text-slate-900 leading-tight group-hover:text-sync-blue transition-colors line-clamp-2">{article.title}</h3>
              <p className="text-slate-500 text-sm leading-relaxed font-medium line-clamp-3">{article.excerpt}</p>
              
              {summaries[article.id] && (
                <div className="p-6 bg-blue-50/50 border border-blue-100 rounded-[2rem] animate-slide-up">
                  <span className="text-[8px] font-black text-sync-blue uppercase tracking-widest block mb-2 opacity-60">AI Memory Synthesis</span>
                  <p className="text-[11px] font-bold text-slate-700 italic leading-relaxed">"{summaries[article.id]}"</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-8 border-t border-slate-50">
                 <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-400">
                       {article.author.charAt(0)}
                    </div>
                    <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">{article.author}</span>
                 </div>
                 <span className={`w-2 h-2 rounded-full ${article.importance === 'high' ? 'bg-rose-500 animate-pulse' : article.importance === 'medium' ? 'bg-amber-400' : 'bg-slate-300'}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const SettingsView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto pb-32">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Administration</h1>
        <p className="text-slate-400 text-2xl font-medium">System configuration and security protocols.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-10">
          <section className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm space-y-10">
            <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8 flex items-center gap-4">
              <svg className="w-8 h-8 text-sync-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              Storage Infrastructure
            </h3>
            <div className="space-y-10">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Allocated Resources</span>
                  <div className="text-5xl font-display font-black text-sync-blue">{stats.storageUsed} <span className="text-slate-200 text-3xl">/ {config.maxStorageMb} MB</span></div>
                </div>
                <button onClick={handleClearCache} className="px-8 py-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-lg shadow-rose-100">Wipe Cache</button>
              </div>
              <div className="space-y-6">
                <div className="flex justify-between items-center"><span className="text-xs font-black uppercase tracking-widest text-slate-700">Storage Reservation</span><span className="font-mono text-sm font-bold text-sync-blue">{config.maxStorageMb} MB</span></div>
                <input type="range" min="500" max="10000" step="100" className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-sync-blue" value={config.maxStorageMb} onChange={(e) => updateConfig('maxStorageMb', parseInt(e.target.value))} />
              </div>
            </div>
          </section>

          <section className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm space-y-10">
            <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8 flex items-center gap-4">
              <svg className="w-8 h-8 text-sync-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10.5 10.5 0 0114.142 0M1.414 8.414a15.5 15.5 0 0121.172 0" /></svg>
              Uplink Protocols
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
              <ToggleRow label="Wi-Fi restricted downloads" description="Lock data bridge to local hotspots." active={config.wifiOnly} onToggle={() => toggleConfig('wifiOnly')} />
              <ToggleRow label="Dynamic signal throttling" description="Protect session integrity on weak links." active={config.autoPauseWeak} onToggle={() => toggleConfig('autoPauseWeak')} />
              <ToggleRow label="Auto-uplink recovery" description="Resume stream upon signal restoration." active={config.autoResume} onToggle={() => toggleConfig('autoResume')} />
              <ToggleRow label="Automated cache purging" description="Clean legacy packets automatically." active={config.autoDeleteOld} onToggle={() => toggleConfig('autoDeleteOld')} />
            </div>
          </section>
        </div>

        <div className="space-y-10">
          <section className="bg-sync-dark p-10 rounded-[4rem] text-white shadow-2xl space-y-8">
             <h3 className="text-2xl font-display font-black border-b border-slate-800 pb-6">Account Verification</h3>
             <div className="space-y-6">
                <div className="flex items-center gap-5 p-5 bg-slate-800/40 rounded-3xl border border-slate-700/50">
                   <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} className="w-14 h-14 rounded-2xl bg-white/5" alt="user" />
                   <div className="overflow-hidden">
                      <div className="text-base font-black truncate">{session.user?.firstName} {session.user?.lastName}</div>
                      <div className="text-[10px] text-slate-500 truncate uppercase font-bold tracking-widest">{session.user?.email}</div>
                   </div>
                </div>
                <button onClick={handleLogout} className="w-full py-5 bg-rose-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-all shadow-2xl shadow-rose-900/40">Terminate Session</button>
             </div>
          </section>

          <section className="bg-white p-10 rounded-[4rem] border border-slate-100 shadow-sm space-y-8">
             <h3 className="text-2xl font-display font-black text-sync-dark border-b border-slate-50 pb-6">System Health</h3>
             <div className="space-y-6">
                <div className="flex justify-between items-center text-sm font-bold">
                   <span className="text-slate-400">Database Engine</span>
                   <span className="text-emerald-500">IndexedDB V{dbService ? '6.0' : '0.0'}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold">
                   <span className="text-slate-400">Service Status</span>
                   <span className="text-sync-blue">Operational</span>
                </div>
                <button onClick={() => window.location.reload()} className="w-full py-4 bg-slate-50 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all">Reload Subsystem</button>
             </div>
          </section>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans selection:bg-sync-blue/10 selection:text-sync-blue">
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-3xl border-b border-slate-100 h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => { if (session.isAuthenticated) { setActiveView('home'); setSelectedArticle(null); } }}>
            <div className="w-12 h-12 bg-sync-blue rounded-2xl flex items-center justify-center text-white shadow-xl group-hover:scale-105 transition-transform">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block leading-none">
               <span className="text-2xl font-display font-black tracking-tighter">SyncFlow</span>
               <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1 block">Enterprise Node</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} signalStrength={network.signalStrength} isMetered={network.isMetered} />
            {session.isAuthenticated && (
              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shadow-sm hover:scale-105 transition-transform cursor-pointer">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} alt="avatar" />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-16 pb-32">
        {activeView === 'auth' && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="w-full max-w-lg bg-white p-16 rounded-[4.5rem] shadow-2xl border border-slate-50 animate-slide-up relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-sync-blue"></div>
              <div className="flex flex-col items-center mb-12 text-center">
                <h1 className="text-6xl font-display font-black tracking-tighter">SyncFlow</h1>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-4 opacity-60">Identity Management Gateway</p>
              </div>
              {errorMsg && <div className="mb-8 p-5 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{errorMsg}</div>}
              {authSuccessMsg && <div className="mb-8 p-5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{authSuccessMsg}</div>}
              {authView === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-8">
                  <AuthField name="email" type="email" label="Identity Reference (Email)" placeholder="name@domain.com" />
                  <AuthField name="password" type="password" label="Access Key" placeholder="••••••••" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-blue-200 hover:scale-[1.02] active:scale-95 transition-all">
                    {authLoading ? 'Verifying...' : 'Authenticate'}
                  </button>
                  <button type="button" onClick={() => setAuthView('register')} className="w-full text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-sync-blue transition-colors">Register New Hardware Node</button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <AuthField name="firstName" label="Given Name" placeholder="Jane" />
                    <AuthField name="lastName" label="Family Name" placeholder="Doe" />
                  </div>
                  <AuthField name="email" type="email" label="Email Address" placeholder="name@domain.com" />
                  <AuthField name="password" type="password" label="Create Access Key" placeholder="••••••••" />
                  <AuthField name="confirmPassword" type="password" label="Verify Access Key" placeholder="••••••••" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl hover:scale-105 transition-all">Enroll Identity</button>
                  <button type="button" onClick={() => setAuthView('login')} className="w-full text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-sync-blue transition-colors">Return to Identity Hub</button>
                </form>
              )}
            </div>
          </div>
        )}

        {session.isAuthenticated && activeView === 'home' && <HomeSyncView />}
        {session.isAuthenticated && activeView === 'library' && <LibraryView />}
        {session.isAuthenticated && activeView === 'settings' && <SettingsView />}

        {session.isAuthenticated && activeView === 'reader' && selectedArticle && (
           <div className="max-w-5xl mx-auto animate-slide-up">
              <button onClick={() => { setActiveView('library'); }} className="mb-10 flex items-center gap-6 text-slate-400 hover:text-slate-900 font-bold transition-all group">
                 <div className="w-14 h-14 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm group-hover:shadow-lg transition-all"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg></div>
                 <span className="text-lg">Return to Knowledge Core</span>
              </button>
              <article className="bg-white rounded-[5rem] border border-slate-50 overflow-hidden shadow-2xl">
                 <div className="relative h-[650px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                    <div className="absolute bottom-20 left-20 right-20 space-y-8">
                       <h1 className="text-7xl font-display font-black text-white leading-none tracking-tight drop-shadow-2xl">{selectedArticle.title}</h1>
                       <div className="flex gap-4">
                          <button onClick={() => handleSummarize(selectedArticle)} disabled={loadingSummaries[selectedArticle.id]} className="px-10 py-5 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-2xl text-[11px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-3">
                             {loadingSummaries[selectedArticle.id] ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                             AI Synthesis
                          </button>
                       </div>
                    </div>
                 </div>
                 <div className="px-20 md:px-40 py-32">
                    {summaries[selectedArticle.id] && (
                      <div className="mb-20 p-12 bg-blue-50/50 border border-blue-100 rounded-[4rem] text-3xl font-display font-bold text-slate-800 italic leading-relaxed animate-slide-up">
                        <span className="block text-[10px] font-black text-sync-blue uppercase tracking-widest mb-8 opacity-40">Synthetic Summary Output</span>
                        "{summaries[selectedArticle.id]}"
                      </div>
                    )}
                    <div className="prose prose-slate prose-2xl max-w-none text-slate-700 leading-relaxed font-medium">
                       {selectedArticle.content.split('. ').map((p, i) => <p key={i} className="mb-12 opacity-90">{p}.</p>)}
                    </div>
                 </div>
              </article>
           </div>
        )}
      </main>

      {session.isAuthenticated && (
        <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
          <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-8 py-5 rounded-[3.5rem] shadow-2xl flex items-center gap-4 border border-slate-700/50">
            <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} label="Sync" active={activeView === 'home'} onClick={() => { setActiveView('home'); setSelectedArticle(null); }} />
            <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>} label="Library" active={activeView === 'library'} onClick={() => { setActiveView('library'); setSelectedArticle(null); }} />
            <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} label="Admin" active={activeView === 'settings'} onClick={() => { setActiveView('settings'); setSelectedArticle(null); }} />
          </div>
        </nav>
      )}
    </div>
  );
};

// --- Helper UI Components ---

const SyncActionButton = ({ onClick, disabled, label, variant }: { onClick: any, disabled: boolean, label: string, variant: string }) => {
  const styles: Record<string, string> = {
    blue: 'bg-sync-blue text-white shadow-blue-200',
    slate: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
    rose: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
    emerald: 'bg-emerald-50 text-emerald-600 shadow-emerald-100 hover:bg-emerald-100',
    white: 'bg-white text-sync-dark hover:bg-slate-100',
    dark: 'bg-slate-800 text-slate-400 hover:text-white'
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`py-6 rounded-3xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.03] active:scale-95 shadow-xl disabled:opacity-20 disabled:scale-100 ${styles[variant]}`}>
      {label}
    </button>
  );
};

const TelemetryItem = ({ label, value, color = 'text-slate-900' }: { label: string, value: string, color?: string }) => (
  <div className="space-y-2">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{label}</span>
    <span className={`text-2xl font-display font-black ${color}`}>{value}</span>
  </div>
);

const AuthField = ({ name, type = 'text', label, placeholder }: any) => (
  <div className="space-y-3">
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-3">{label}</label>
    <input name={name} type={type} required placeholder={placeholder} className="w-full bg-slate-50 border border-slate-100 rounded-[2rem] px-8 py-5 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
  </div>
);

const NavButton = ({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button onClick={onClick} className={`flex items-center gap-4 px-10 py-4 rounded-[2.5rem] transition-all duration-500 ${active ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}>
    {icon}
    <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${active ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}`}>{label}</span>
  </button>
);

const ToggleRow = ({ label, description, active, onToggle, inverted = false }: { label: string, description: string, active: boolean, onToggle: () => void, inverted?: boolean }) => (
  <div className="flex items-center justify-between gap-6 group">
    <div className="flex-1">
      <div className={`text-sm font-black transition-colors ${inverted ? 'text-white' : 'text-slate-900 group-hover:text-sync-blue'}`}>{label}</div>
      <div className={`text-[10px] font-medium leading-tight mt-1 opacity-60 ${inverted ? 'text-slate-400' : 'text-slate-500'}`}>{description}</div>
    </div>
    <button onClick={onToggle} className={`w-14 h-7 rounded-full relative transition-all duration-300 ${active ? 'bg-sync-blue shadow-lg' : 'bg-slate-200'}`}>
      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-300 ${active ? 'left-8' : 'left-1'}`} />
    </button>
  </div>
);

export default App;
