
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { 
  NetworkStatus, Article, SyncStats, SyncConfig, Category, SyncStatus, 
  UserSession, SyncLog, DownloadState, OfflineSessionState, User, NetworkQuality
} from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import { supabase, getAuthHeader } from './services/supabase';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

type View = 'auth' | 'home' | 'library' | 'settings' | 'reader';
type AuthView = 'login' | 'register';

const SyncActionButton = memo(({ onClick, disabled, label, variant }: { onClick: () => void, disabled?: boolean, label: string, variant: string }) => {
  const styles: Record<string, string> = {
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
});

const TelemetryItem = memo(({ label, value, color = 'text-slate-900' }: { label: string, value: string, color?: string }) => (
  <div className="space-y-2">
    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{label}</span>
    <span className={`text-2xl font-display font-black ${color}`}>{value}</span>
  </div>
));

const AuthField = memo(({ name, type = 'text', label, placeholder }: any) => (
  <div className="space-y-3">
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-3">{label}</label>
    <input name={name} type={type} required placeholder={placeholder} className="w-full bg-slate-50 border border-slate-100 rounded-[2rem] px-8 py-5 font-bold outline-none transition-all text-slate-900" />
  </div>
));

const NavButton = memo(({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button type="button" onClick={onClick} className={`flex items-center gap-4 px-10 py-4 rounded-[2.5rem] transition-all duration-500 ${active ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}>
    {icon}
    <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-all duration-500 ${active ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'}`}>{label}</span>
  </button>
));

const ToggleRow = memo(({ label, description, active, onToggle, inverted = false }: { label: string, description: string, active: boolean, onToggle: () => void, inverted?: boolean }) => (
  <div className="flex items-center justify-between gap-6 group">
    <div className="flex-1">
      <div className={`text-sm font-black transition-colors ${inverted ? 'text-white' : 'text-slate-900 group-hover:text-sync-blue'}`}>{label}</div>
      <div className={`text-[10px] font-medium leading-tight mt-1 opacity-60 ${inverted ? 'text-slate-400' : 'text-slate-500'}`}>{description}</div>
    </div>
    <button type="button" onClick={onToggle} className={`w-14 h-7 rounded-full relative transition-all duration-300 ${active ? 'bg-sync-blue shadow-lg' : 'bg-slate-200'}`}>
      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-300 ${active ? 'left-8' : 'left-1'}`} />
    </button>
  </div>
));

const App: React.FC = () => {
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  const [activeView, setActiveView] = useState<View>('auth');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [network, setNetwork] = useState({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false, signalStrength: 100, effectiveType: '4g' });
  const [articles, setArticles] = useState<Article[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [offlineState, setOfflineState] = useState<OfflineSessionState>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [downloadBuffer, setDownloadBuffer] = useState<Article[]>([]);
  const [stats, setStats] = useState<SyncStats>({ totalCount: 0, cachedCount: 0, lastSync: null, storageUsed: '0 KB', quotaUsedPercent: 0, transferSpeed: 0, categoryBreakdown: [], remainingDataSizeKb: 0, etaSeconds: 0 });

  const activeSessionId = useRef<string | null>(null);
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const networkRef = useRef(network);
  
  // Use state for config instead of ref to ensure UI updates when settings change
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
  const isDbReady = useRef(false);

  useEffect(() => { networkRef.current = network; }, [network]);

  // Fix: Added toggleConfig function to update state and trigger UI re-renders
  const toggleConfig = useCallback((key: keyof SyncConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
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
      setStats(prev => ({ ...prev, cachedCount: items.length, lastSync: logsData[0]?.timestamp || prev.lastSync, storageUsed: storage.usedStr, quotaUsedPercent: storage.percent, categoryBreakdown: breakdown }));
    } catch (err) { console.error("UI Update Failed", err); }
  }, [searchQuery]);

  useEffect(() => {
    const init = async () => {
      if (isDbReady.current) return;
      await dbService.init();
      isDbReady.current = true;
      refreshUI();
    };
    init();
  }, [refreshUI]);

  const handleStartDownload = useCallback(async () => {
    if (isDownloadingRef.current) return;
    if (networkRef.current.status === NetworkStatus.OFFLINE) {
      setErrorMsg("Link failure. Uplink required.");
      return;
    }

    setDownloadState('downloading');
    isDownloadingRef.current = true;
    setErrorMsg(null);

    try {
      // Backend: Start Session
      const headers = await getAuthHeader();
      if (downloadIdxRef.current === 0) {
        const res = await fetch('/api/sync/session', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ totalItems: articles.length })
        });
        const sessionData = await res.json();
        activeSessionId.current = sessionData.id;
      }

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

      const syncLoop = async () => {
        if (!isDownloadingRef.current) return;
        if (downloadIdxRef.current >= downloadSourceRef.current.length) {
          setDownloadState('completed');
          isDownloadingRef.current = false;
          // Notify Backend
          if (activeSessionId.current) {
            await fetch(`/api/sync/session/${activeSessionId.current}`, {
              method: 'PATCH',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ progress: 100, status: 'completed' })
            });
          }
          return;
        }

        const article = downloadSourceRef.current[downloadIdxRef.current];
        await new Promise(r => setTimeout(r, 100)); // Sim speed
        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        const prog = Math.round((downloadIdxRef.current / downloadSourceRef.current.length) * 100);
        setSyncProgress(prog);
        
        // Push Progress to Cloud periodically
        if (prog % 5 === 0 && activeSessionId.current) {
          fetch(`/api/sync/session/${activeSessionId.current}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ progress: prog, status: 'downloading' })
          });
        }
        syncLoop();
      };
      syncLoop();
    } catch (e) {
      setDownloadState('paused');
      isDownloadingRef.current = false;
    }
  }, [articles.length]);

  const handlePauseDownload = useCallback(() => {
    isDownloadingRef.current = false;
    setDownloadState('paused');
  }, []);

  const handleSaveData = async () => {
    if (downloadBuffer.length === 0) return;
    setDownloadState('saving');
    const itemsCount = downloadBuffer.length;
    for (const art of downloadBuffer) await dbService.saveArticle(art);
    
    // Backend Log
    const headers = await getAuthHeader();
    await fetch('/api/sync/log', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'manual', status: 'success', details: `Saved ${itemsCount} packets.`, itemsSynced: itemsCount })
    });

    setDownloadBuffer([]);
    downloadIdxRef.current = 0;
    setSyncProgress(0);
    setDownloadState('idle');
    refreshUI();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const { session: userSession, error } = await supabase.auth.signInWithPassword({ 
      email: fd.get('email') as string, 
      password: fd.get('password') as string 
    });
    if (error) setErrorMsg(error.message);
    else if (userSession) { setSession(userSession); setActiveView('home'); }
    setAuthLoading(false);
  };

  if (activeView === 'auth') {
    return (
      <div className="min-h-screen bg-sync-light flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white p-16 rounded-[4.5rem] shadow-2xl border border-slate-50 animate-slide-up relative">
          <div className="absolute top-0 left-0 w-full h-2 bg-sync-blue"></div>
          <div className="text-center mb-12">
            <h1 className="text-6xl font-display font-black tracking-tighter">SyncFlow</h1>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-4 opacity-60">Identity Management</p>
          </div>
          {errorMsg && <div className="mb-8 p-5 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{errorMsg}</div>}
          <form onSubmit={handleLogin} className="space-y-8">
            <AuthField name="email" type="email" label="Reference ID" placeholder="name@domain.com" />
            <AuthField name="password" type="password" label="Access Key" placeholder="••••••••" />
            <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-blue-200 hover:scale-102 transition-all">
              {authLoading ? 'Verifying...' : 'Authenticate Node'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans">
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-3xl border-b h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setActiveView('home')}>
            <div className="w-12 h-12 bg-sync-blue rounded-2xl flex items-center justify-center text-white"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
            <span className="text-2xl font-display font-black">SyncFlow</span>
          </div>
          <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} signalStrength={network.signalStrength} isMetered={network.isMetered} />
        </div>
      </header>
      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-16 pb-32">
        {activeView === 'home' && (
          <div className="animate-slide-up space-y-12 max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div className="bg-white p-10 rounded-[3rem] border space-y-10">
                <h3 className="text-3xl font-display font-black">Sync Engine</h3>
                <div className="grid grid-cols-2 gap-4">
                  <SyncActionButton onClick={handleStartDownload} disabled={downloadState === 'downloading'} label="Start Sync" variant="blue" />
                  <SyncActionButton onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} label="Pause" variant="slate" />
                  <SyncActionButton onClick={handleSaveData} disabled={downloadBuffer.length === 0} label={`Commit (${downloadBuffer.length})`} variant="emerald" />
                </div>
                {syncProgress > 0 && <ProgressBar progress={syncProgress} label={`Streaming: ${downloadState}`} />}
              </div>
              <div className="bg-sync-dark p-10 rounded-[3rem] text-white space-y-10">
                <h3 className="text-3xl font-display font-black">Cloud Stats</h3>
                <TelemetryItem label="Total Packets" value={stats.cachedCount.toString()} color="text-white" />
                <TelemetryItem label="Storage" value={stats.storageUsed} color="text-sync-cyan" />
              </div>
            </div>
          </div>
        )}
        {activeView === 'library' && (
          <div className="animate-slide-up space-y-12">
            <h2 className="text-8xl font-display font-black tracking-tighter">Library</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
              {articles.map(article => (
                <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[3.5rem] border overflow-hidden cursor-pointer hover:shadow-2xl transition-all">
                  <img src={article.imageUrl} className="w-full aspect-video object-cover" alt="cover" />
                  <div className="p-10 space-y-4">
                    <h3 className="text-2xl font-display font-black leading-tight line-clamp-2">{article.title}</h3>
                    <p className="text-slate-500 text-sm line-clamp-3">{article.excerpt}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeView === 'settings' && (
          <div className="animate-slide-up space-y-12 max-w-4xl mx-auto">
            <h1 className="text-7xl font-display font-black text-center">Admin</h1>
            <div className="bg-white p-10 rounded-[4rem] border space-y-10">
              <ToggleRow label="Wi-Fi only downloads" description="Protect cellular data bridge." active={config.wifiOnly} onToggle={() => toggleConfig('wifiOnly')} />
              <button onClick={() => supabase.auth.signOut().then(() => setActiveView('auth'))} className="w-full py-5 bg-rose-500 text-white rounded-2xl font-black uppercase text-xs">Terminate Session</button>
            </div>
          </div>
        )}
        {activeView === 'reader' && selectedArticle && (
          <article className="animate-slide-up max-w-5xl mx-auto bg-white rounded-[5rem] overflow-hidden">
            <div className="relative h-[500px]">
              <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <h1 className="absolute bottom-12 left-12 right-12 text-6xl font-display font-black text-white">{selectedArticle.title}</h1>
            </div>
            <div className="p-20 text-slate-700 text-2xl leading-relaxed">{selectedArticle.content}</div>
          </article>
        )}
      </main>
      <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200]">
        <div className="bg-sync-dark/95 backdrop-blur-3xl px-8 py-5 rounded-[3.5rem] flex items-center gap-4 border border-slate-700">
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} label="Sync" active={activeView === 'home'} onClick={() => setActiveView('home')} />
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>} label="Library" active={activeView === 'library'} onClick={() => setActiveView('library')} />
          <NavButton icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} label="Admin" active={activeView === 'settings'} onClick={() => setActiveView('settings')} />
        </div>
      </nav>
    </div>
  );
};

export default App;
