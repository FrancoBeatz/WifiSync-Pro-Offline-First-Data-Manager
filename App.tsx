
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

// --- Types ---

// Define types for UI state
type View = 'auth' | 'home' | 'library' | 'settings' | 'reader';
type AuthView = 'login' | 'signup' | 'forgot';

// --- Sub-Components (Defined outside main App to prevent remounting on every render) ---

const SyncActionButton: React.FC<{ 
  onClick: () => void; 
  disabled: boolean; 
  label: string; 
  variant: 'blue' | 'slate' | 'rose' | 'emerald' | 'white' | 'dark' 
}> = ({ onClick, disabled, label, variant }) => {
  const styles = {
    blue: 'bg-sync-blue text-white shadow-blue-200',
    slate: 'bg-slate-50 text-slate-700 hover:bg-slate-100',
    rose: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
    emerald: 'bg-emerald-50 text-emerald-600 shadow-emerald-100 hover:bg-emerald-100',
    white: 'bg-white text-sync-dark hover:bg-slate-100',
    dark: 'bg-slate-800 text-slate-400 hover:text-white'
  };
  return (
    <button 
      type="button"
      onClick={onClick} 
      disabled={disabled} 
      className={`py-6 rounded-3xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.03] active:scale-95 shadow-xl disabled:opacity-20 disabled:scale-100 ${styles[variant]}`}
    >
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

const ToggleRow = ({ label, description, active, onToggle, inverted = false }: { label: string, description: string, active: boolean, onToggle: () => void, inverted?: boolean }) => (
  <div className="flex items-center justify-between gap-6 group">
    <div className="flex-1">
      <div className={`text-sm font-black transition-colors ${inverted ? 'text-white' : 'text-slate-900 group-hover:text-sync-blue'}`}>{label}</div>
      <div className={`text-[10px] font-medium leading-tight mt-1 opacity-60 ${inverted ? 'text-slate-400' : 'text-slate-500'}`}>{description}</div>
    </div>
    <button 
      type="button"
      onClick={onToggle} 
      className={`w-14 h-7 rounded-full relative transition-all duration-300 ${active ? 'bg-sync-blue shadow-lg' : 'bg-slate-200'}`}
    >
      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-300 ${active ? 'left-8' : 'left-1'}`} />
    </button>
  </div>
);

const NavButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button 
    type="button"
    onClick={onClick} 
    className={`flex items-center gap-4 px-10 py-4 rounded-[2.5rem] transition-all duration-500 ${active ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}
  >
    {icon}
    <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${active ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}`}>{label}</span>
  </button>
);

// --- Main Application Component ---

const App: React.FC = () => {
  // Core System States
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  // Fix: Used explicitly defined View and AuthView types
  const [activeView, setActiveView] = useState<View>('auth');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [network, setNetwork] = useState({ 
    status: NetworkStatus.ONLINE, 
    speed: 10, 
    isMetered: false, 
    signalStrength: 100,
    effectiveType: '4g' 
  });
  
  // Data State
  const [articles, setArticles] = useState<Article[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({});
  
  // Sync Logic States
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [offlineState, setOfflineState] = useState<OfflineSessionState>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [downloadBuffer, setDownloadBuffer] = useState<Article[]>([]);
  const [stats, setStats] = useState<SyncStats>({ 
    totalCount: 0, cachedCount: 0, lastSync: null, storageUsed: '0 KB', 
    quotaUsedPercent: 0, transferSpeed: 0, categoryBreakdown: [],
    remainingDataSizeKb: 0, etaSeconds: 0
  });

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);

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

  // Refs for non-rendering logic stability
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const isDbReady = useRef(false);
  const networkRef = useRef(network);
  const configRef = useRef(config);
  const downloadStateRef = useRef(downloadState);

  useEffect(() => { networkRef.current = network; }, [network]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);

  // Initial Boot
  useEffect(() => {
    const init = async () => {
      if (!isDbReady.current) {
        await dbService.init();
        isDbReady.current = true;
        await refreshUI();
      }
    };
    init();
  }, []);

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
      console.error("UI Update Failed", err);
    }
  }, [searchQuery]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => refreshUI(), 300);
    return () => clearTimeout(handler);
  }, [searchQuery, refreshUI]);

  // --- Handlers ---

  const handleStartDownload = useCallback(async () => {
    if (isDownloadingRef.current) return;
    if (networkRef.current.status === NetworkStatus.OFFLINE) {
      setErrorMsg("No active connection detected.");
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
        const sensitivity = configRef.current.connectivitySensitivity === 'low' ? 0.5 : configRef.current.connectivitySensitivity === 'high' ? 1.5 : 1.0;
        const baseSpeed = (100 + (signal / 100) * 8000) * sensitivity;
        const delay = (article.sizeKb / baseSpeed) * 1000;

        await new Promise(r => setTimeout(r, Math.max(10, delay)));
        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        setSyncProgress((downloadIdxRef.current / downloadSourceRef.current.length) * 100);
        
        if (downloadIdxRef.current % 10 === 0) {
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
      console.error("Sync Stream Fault", e);
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
      details: `Injected ${itemsCount} data packets into local hub.`,
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
    if (window.confirm("Purge all local data? This action is permanent.")) {
      await dbService.clear();
      await dbService.addSyncLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: 'manual',
        status: 'success',
        details: 'Local knowledge core purged.',
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
      console.error("AI Fault", e);
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [article.id]: false }));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthLoading(true);
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    try {
      const { session: s, error } = await supabase.auth.signInWithPassword({
        email: formData.get('email') as string,
        password: formData.get('password') as string
      });
      if (error) throw error;
      if (s) {
        setSession(s);
        setActiveView('home');
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Auth failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Fix: Implemented toggleConfig to handle boolean config property toggling
  const toggleConfig = useCallback((key: keyof SyncConfig) => {
    setConfig(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  }, []);

  // Fix: Implemented handleLogout to clear session and redirect to auth
  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession({ user: null, isAuthenticated: false });
    setActiveView('auth');
  }, []);

  // --- Network Watcher ---
  useEffect(() => {
    const watcher = async () => {
      const q = await getNetworkQuality();
      setNetwork(prev => {
        if (prev.status === q.status && prev.signalStrength === q.signalStrength) return prev;
        
        // Auto-Handling
        if (isDownloadingRef.current && configRef.current.autoPauseWeak) {
          const isCritical = q.status === NetworkStatus.OFFLINE || q.status === NetworkStatus.WEAK || q.signalStrength < 30;
          const meteredConstraint = configRef.current.wifiOnly && q.isMetered;
          if (isCritical || meteredConstraint) handlePauseDownload();
        } else if (downloadStateRef.current === 'paused' && configRef.current.autoResume) {
          const isStrong = q.status === NetworkStatus.ONLINE && q.signalStrength > 60;
          const wifiOk = !configRef.current.wifiOnly || !q.isMetered;
          if (isStrong && wifiOk) handleStartDownload();
        }
        return q;
      });
    };
    const tid = setInterval(watcher, 4000);
    return () => clearInterval(tid);
  }, [handlePauseDownload, handleStartDownload]);

  // --- Views ---

  if (activeView === 'auth') {
    return (
      <div className="min-h-screen bg-sync-light flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white p-12 md:p-16 rounded-[4.5rem] shadow-2xl border border-slate-50 animate-slide-up relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-sync-blue"></div>
          <div className="flex flex-col items-center mb-12 text-center">
            <h1 className="text-6xl font-display font-black tracking-tighter">SyncFlow</h1>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-4 opacity-60">Identity Management</p>
          </div>
          {errorMsg && <div className="mb-8 p-5 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{errorMsg}</div>}
          <form onSubmit={handleLogin} className="space-y-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-3">Email Reference</label>
              <input name="email" type="email" required placeholder="name@domain.com" className="w-full bg-slate-50 border border-slate-100 rounded-[2rem] px-8 py-5 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-3">Access Key</label>
              <input name="password" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-100 rounded-[2rem] px-8 py-5 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
            </div>
            <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl hover:scale-[1.02] active:scale-95 transition-all">
              {authLoading ? 'Verifying...' : 'Authenticate'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans selection:bg-sync-blue/10 selection:text-sync-blue">
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-3xl border-b border-slate-100 h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => { setActiveView('home'); setSelectedArticle(null); }}>
            <div className="w-12 h-12 bg-sync-blue rounded-2xl flex items-center justify-center text-white shadow-xl group-hover:scale-105 transition-transform">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block leading-none">
               <span className="text-2xl font-display font-black tracking-tighter">SyncFlow</span>
               <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1 block">Data Node</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <NetworkStatusBadge 
              status={network.status} 
              effectiveType={`${network.speed}Mbps`} 
              signalStrength={network.signalStrength} 
              isMetered={network.isMetered} 
            />
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shadow-sm hover:scale-105 transition-transform cursor-pointer">
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} alt="avatar" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-16 pb-32">
        {activeView === 'home' && (
          <div className="animate-slide-up space-y-12 max-w-6xl mx-auto">
            <div className="text-center space-y-4 mb-12">
              <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h1>
              <p className="text-slate-400 text-2xl font-medium">Uplink and downlink synchronization management.</p>
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
                  <SyncActionButton onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} label="Start Sync" variant="blue" />
                  <SyncActionButton onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} label="Pause" variant="slate" />
                  <SyncActionButton onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} label="Stop" variant="rose" />
                  <SyncActionButton onClick={handleSaveData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} label={`Commit (${downloadBuffer.length})`} variant="emerald" />
                </div>
                {(downloadState !== 'idle' || syncProgress > 0) && (
                  <div className="pt-8 border-t border-slate-50">
                    <ProgressBar progress={syncProgress} label={`Sync Stream: ${downloadState}`} speed={downloadState === 'downloading' ? (stats.transferSpeed || 0) * 1024 : 0} remainingKb={stats.remainingDataSizeKb} />
                  </div>
                )}
              </div>
              <div className="bg-sync-dark p-10 rounded-[3rem] text-white shadow-2xl space-y-10 flex flex-col justify-between">
                <div>
                  <h3 className="text-3xl font-display font-black mb-8">Offline Hub</h3>
                  <p className="text-slate-400 text-lg font-medium opacity-80 mb-10">Access locally stored data clusters without an active uplink.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <SyncActionButton onClick={() => setOfflineState('active')} disabled={offlineState === 'active'} label="Activate Local" variant="white" />
                    <SyncActionButton onClick={() => setOfflineState('idle')} disabled={offlineState === 'idle'} label="Standby" variant="dark" />
                  </div>
                </div>
                <div className="pt-8 border-t border-slate-800 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <span>{stats.cachedCount} Local Packets</span>
                  <span className="font-mono text-sync-blue">IO Latency: 0.1ms</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                <h3 className="text-2xl font-display font-black text-sync-dark mb-8">Signal Telemetry</h3>
                <div className="grid grid-cols-2 gap-8">
                  <TelemetryItem label="Effective Type" value={network.effectiveType.toUpperCase()} />
                  <TelemetryItem label="Throughput" value={`${network.speed} Mbps`} />
                  <TelemetryItem label="Metered" value={network.isMetered ? 'Yes' : 'No'} color={network.isMetered ? 'text-amber-500' : 'text-emerald-500'} />
                  <TelemetryItem label="Signal" value={`${network.signalStrength}%`} />
                </div>
              </div>
              <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
                <h3 className="text-2xl font-display font-black text-sync-dark mb-8">System Logs</h3>
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
        )}

        {activeView === 'library' && (
          <div className="animate-slide-up space-y-12">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
              <div className="space-y-4">
                <h2 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Knowledge</h2>
                <p className="text-slate-400 text-2xl font-medium uppercase tracking-widest opacity-60">{stats.cachedCount} Local Clusters</p>
              </div>
              <div className="relative w-full md:w-96 group">
                <input type="text" placeholder="Query cache..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border-2 border-slate-50 rounded-3xl py-5 px-10 text-lg font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none shadow-lg transition-all" />
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
                        <span className="text-[8px] font-black text-sync-blue uppercase tracking-widest block mb-2 opacity-60">AI Memory Cache</span>
                        <p className="text-[11px] font-bold text-slate-700 italic leading-relaxed">"{summaries[article.id]}"</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-8 border-t border-slate-50">
                       <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">{article.author}</span>
                       <span className={`w-2 h-2 rounded-full ${article.importance === 'high' ? 'bg-rose-500 animate-pulse' : 'bg-slate-300'}`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeView === 'settings' && (
          <div className="animate-slide-up space-y-12 max-w-6xl mx-auto pb-32">
            <div className="text-center space-y-4 mb-12">
              <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Admin</h1>
              <p className="text-slate-400 text-2xl font-medium">Core system and security configuration.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="lg:col-span-2 space-y-10">
                <section className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm space-y-10">
                  <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8 flex items-center gap-4">Infrastructure</h3>
                  <div className="space-y-10">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Allocated Resources</span>
                        <div className="text-5xl font-display font-black text-sync-blue">{stats.storageUsed} <span className="text-slate-200 text-3xl">/ {config.maxStorageMb} MB</span></div>
                      </div>
                      <button type="button" onClick={handleClearCache} className="px-8 py-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-all">Reset Core</button>
                    </div>
                  </div>
                </section>
                <section className="bg-white p-12 rounded-[4rem] border border-slate-100 shadow-sm space-y-10">
                  <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8">Protocols</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-12">
                    <ToggleRow label="Wi-Fi Only Sync" description="Block data usage on cellular links." active={config.wifiOnly} onToggle={() => toggleConfig('wifiOnly')} />
                    <ToggleRow label="Auto-Pause Alert" description="Pause stream on signal degradation." active={config.autoPauseWeak} onToggle={() => toggleConfig('autoPauseWeak')} />
                    <ToggleRow label="Auto-Recovery" description="Resume session upon signal restoration." active={config.autoResume} onToggle={() => toggleConfig('autoResume')} />
                    <ToggleRow label="Smart AI summaries" description="Generate pre-cached text digests." active={config.smartSummaries} onToggle={() => toggleConfig('smartSummaries')} />
                  </div>
                </section>
              </div>
              <div className="space-y-10">
                <section className="bg-sync-dark p-10 rounded-[4rem] text-white shadow-2xl space-y-8">
                   <h3 className="text-2xl font-display font-black border-b border-slate-800 pb-6">Account</h3>
                   <div className="space-y-6">
                      <div className="flex items-center gap-5 p-5 bg-slate-800/40 rounded-3xl border border-slate-700/50">
                         <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} className="w-14 h-14 rounded-2xl bg-white/5" alt="user" />
                         <div className="text-base font-black truncate">{session.user?.firstName}</div>
                      </div>
                      <button type="button" onClick={handleLogout} className="w-full py-5 bg-rose-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-all">Deauthorize</button>
                   </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {activeView === 'reader' && selectedArticle && (
           <div className="max-w-5xl mx-auto animate-slide-up">
              <button type="button" onClick={() => setActiveView('library')} className="mb-10 flex items-center gap-6 text-slate-400 hover:text-slate-900 font-bold transition-all group">
                 <div className="w-14 h-14 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm group-hover:shadow-lg transition-all"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg></div>
                 <span className="text-lg">Return</span>
              </button>
              <article className="bg-white rounded-[5rem] border border-slate-50 overflow-hidden shadow-2xl">
                 <div className="relative h-[650px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                    <div className="absolute bottom-20 left-20 right-20 space-y-8">
                       <h1 className="text-7xl font-display font-black text-white leading-none tracking-tight drop-shadow-2xl">{selectedArticle.title}</h1>
                       <button 
                        type="button"
                        onClick={() => handleSummarize(selectedArticle)} 
                        disabled={loadingSummaries[selectedArticle.id]} 
                        className="px-10 py-5 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-2xl text-[11px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-3"
                       >
                          {loadingSummaries[selectedArticle.id] ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'AI Synthesis'}
                       </button>
                    </div>
                 </div>
                 <div className="px-20 md:px-40 py-32">
                    {summaries[selectedArticle.id] && (
                      <div className="mb-20 p-12 bg-blue-50/50 border border-blue-100 rounded-[4rem] text-3xl font-display font-bold text-slate-800 italic leading-relaxed animate-slide-up">
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

      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
        <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-8 py-5 rounded-[3.5rem] shadow-2xl flex items-center gap-4 border border-slate-700/50">
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} label="Sync" active={activeView === 'home'} onClick={() => { setActiveView('home'); setSelectedArticle(null); }} />
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>} label="Library" active={activeView === 'library'} onClick={() => { setActiveView('library'); setSelectedArticle(null); }} />
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} label="Admin" active={activeView === 'settings'} onClick={() => { setActiveView('settings'); setSelectedArticle(null); }} />
        </div>
      </nav>
    </div>
  );
};

export default App;
