
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  NetworkStatus, Article, SyncStats, SyncConfig, Category, SyncStatus, 
  UserSession, SyncLog, Conflict, Importance, DownloadState, OfflineSessionState, User
} from './types';
import { dbService } from './services/db';
import { fetchArticlesFromCloud } from './services/mockApi';
import { getNetworkQuality } from './services/network';
import { getSmartSummary } from './services/ai';
import { supabase, logSyncEvent } from './services/supabase';
import NetworkStatusBadge from './components/NetworkStatusBadge';
import ProgressBar from './components/ProgressBar';

type View = 'auth' | 'home' | 'sync' | 'settings' | 'reader';
type AuthView = 'login' | 'register' | 'forgot-password';

const App: React.FC = () => {
  // --- Core State Management ---
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  const [activeView, setActiveView] = useState<View>('auth');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [network, setNetwork] = useState({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false, signalStrength: 100 });
  
  // --- Data States ---
  const [articles, setArticles] = useState<Article[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  
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
    autoSync: true, wifiOnly: true, maxStorageMb: 2000,
    preferredCategories: ['Technology', 'Design', 'Future', 'Networking'],
    categoryPriorities: { 'Technology': 'high', 'Design': 'medium', 'Future': 'medium', 'Networking': 'low' },
    smartSummaries: true, retryAttempts: 5
  });

  // --- Ref-based Engine (Prevents unnecessary re-renders in loops) ---
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const networkRef = useRef(network);
  const downloadStateRef = useRef<DownloadState>('idle');
  const retryCountRef = useRef(0);
  const configRef = useRef(config);

  // Keep refs in sync with state for background processes
  useEffect(() => { networkRef.current = network; }, [network]);
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);
  useEffect(() => { configRef.current = config; }, [config]);

  // --- UI Refresh Action ---
  const refreshUI = useCallback(async () => {
    try {
      const items = await dbService.searchArticles(searchQuery);
      const logsData = await dbService.getSyncLogs();
      const history = await dbService.getSearchHistory();
      const storage = await dbService.getStorageStats();
      const breakdown = await dbService.getCategoryBreakdown();
      
      setArticles(items);
      setSearchHistory(history);
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

  // --- Auth logic ---
  const validatePassword = (pass: string) => {
    return pass.length >= 8 && /[0-9]/.test(pass) && /[!@#$%^&*(),.?":{}|<>]/.test(pass) && /[A-Z]/.test(pass);
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
        logSyncEvent(userSession.user?.id || 'unknown', "Session active.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Auth failure.");
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

    if (password !== confirmPassword) return setErrorMsg("Passwords mismatch.");
    if (!validatePassword(password)) return setErrorMsg("Weak password.");

    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ 
        email, 
        password, 
        options: { data: { firstName, lastName } } 
      });
      if (error) throw error;
      setAuthSuccessMsg("Account created. Please login.");
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
    setAuthView('login');
  };

  // --- Article Logic ---
  const handleSummarize = async () => {
    if (!selectedArticle) return;
    setIsSummarizing(true);
    try {
      const summary = await getSmartSummary(selectedArticle);
      setAiSummary(summary);
    } catch (err) {
      console.error("Summary error:", err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const simulateLocalChange = async (article: Article) => {
    const updated = { ...article, hasLocalChanges: true, content: article.content + "\n\n[MODIFIED]" };
    await dbService.saveArticle(updated);
    setSelectedArticle(updated);
    refreshUI();
  };

  // --- Persistent Engine (Resuming) ---
  const handlePauseDownload = useCallback(async () => {
    isDownloadingRef.current = false;
    setDownloadState('paused');
    await dbService.saveSyncState({
      idx: downloadIdxRef.current,
      source: downloadSourceRef.current,
      buffer: downloadBuffer
    });
  }, [downloadBuffer]);

  const handleStopDownload = useCallback(async () => {
    isDownloadingRef.current = false;
    setDownloadState('stopped');
    downloadIdxRef.current = 0;
    setDownloadBuffer([]);
    setSyncProgress(0);
    await dbService.clearSyncState();
  }, []);

  const handleStartDownload = useCallback(async () => {
    if (isDownloadingRef.current) return;
    if (networkRef.current.status === NetworkStatus.OFFLINE) return setErrorMsg("Check connection.");

    setErrorMsg(null);
    setDownloadState('downloading');
    isDownloadingRef.current = true;

    try {
      // Refresh source if starting fresh
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
        const baseSpeed = 100 + (signal / 100) * 8000;
        const delay = (article.sizeKb / (baseSpeed * (0.8 + Math.random() * 0.4))) * 1000;

        await new Promise(r => setTimeout(r, Math.max(10, delay)));
        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => {
          const newBuf = [...prev, article];
          // Optimization: occasionally persist the buffer
          if (newBuf.length % 5 === 0) {
            dbService.saveSyncState({ idx: downloadIdxRef.current, source: downloadSourceRef.current, buffer: newBuf });
          }
          return newBuf;
        });

        downloadIdxRef.current++;
        setSyncProgress((downloadIdxRef.current / downloadSourceRef.current.length) * 100);
        syncLoop();
      };
      
      syncLoop();
    } catch (e) {
      console.error("Stream error", e);
      setDownloadState('paused');
      isDownloadingRef.current = false;
    }
  }, []);

  const handleSaveData = async () => {
    setDownloadState('saving');
    const local = await dbService.getAllArticles();
    const newConflicts: Conflict[] = [];

    for (const art of downloadBuffer) {
      const existing = local.find(l => l.id === art.id);
      if (existing?.hasLocalChanges && art.version >= existing.version) {
        newConflicts.push({ local: existing, remote: art });
      } else {
        await dbService.saveArticle(art);
      }
    }

    setConflicts(prev => [...prev, ...newConflicts]);
    setDownloadBuffer([]);
    downloadIdxRef.current = 0;
    setSyncProgress(0);
    setDownloadState('idle');
    await dbService.clearSyncState();
    refreshUI();
  };

  // --- Application Lifecycle ---
  useEffect(() => {
    const initApp = async () => {
      await dbService.init();
      const saved = await dbService.getSyncState();
      if (saved) {
        downloadIdxRef.current = saved.idx || 0;
        downloadSourceRef.current = saved.source || [];
        setDownloadBuffer(saved.buffer || []);
        if (saved.source?.length) setSyncProgress((saved.idx / saved.source.length) * 100);
      }
      refreshUI();
    };
    initApp();
  }, [refreshUI]);

  // Refined Network Watcher (No flickering)
  useEffect(() => {
    const watcher = async () => {
      const q = await getNetworkQuality();
      setNetwork(prev => {
        // Only update if major change to avoid excessive re-renders
        if (prev.status !== q.status || Math.abs(prev.signalStrength - q.signalStrength) > 5) return q;
        return prev;
      });

      // Logic check for auto-pause
      if (isDownloadingRef.current) {
        const degrade = q.status !== NetworkStatus.ONLINE || q.signalStrength < 15 || (configRef.current.wifiOnly && q.isMetered);
        if (degrade) handlePauseDownload();
      } else if (downloadStateRef.current === 'paused') {
        const restore = q.status === NetworkStatus.ONLINE && q.signalStrength > 45 && (!configRef.current.wifiOnly || !q.isMetered);
        if (restore) handleStartDownload();
      }
    };

    const interval = setInterval(watcher, 3000);
    return () => clearInterval(interval);
  }, [handlePauseDownload, handleStartDownload]);

  // --- Views ---
  const HomeView = () => (
    <div className="animate-slide-up space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h2 className="text-6xl font-display font-black tracking-tighter text-sync-dark">Intelligence Hub</h2>
          <p className="text-slate-400 mt-4 text-xl font-medium">Verified for offline execution. {stats.cachedCount} packets cached.</p>
        </div>
        <div className="relative w-full md:w-96 group">
          <input 
            type="text" placeholder="Filter library..." 
            className="w-full bg-white border border-slate-200 rounded-3xl py-4 px-12 text-sm font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none shadow-sm transition-all"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          />
          <svg className="w-5 h-5 text-slate-300 absolute left-4 top-4 group-focus-within:text-sync-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {(offlineState === 'active' ? articles.filter(a => !!a.cachedAt) : articles).map(article => (
          <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-500">
            <div className="aspect-video relative overflow-hidden">
              <img src={article.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="cover" />
              <div className="absolute top-4 left-4 px-3 py-1 bg-white/90 backdrop-blur rounded-full text-[9px] font-black text-sync-dark uppercase tracking-widest">{article.category}</div>
              {article.hasLocalChanges && <div className="absolute bottom-4 right-4 px-3 py-1 bg-amber-400 rounded-full text-[8px] font-black text-white uppercase tracking-widest shadow-lg">Local Fork</div>}
            </div>
            <div className="p-8">
              <h3 className="text-xl font-display font-bold text-slate-900 mb-3 group-hover:text-sync-blue transition-colors line-clamp-2 leading-tight">{article.title}</h3>
              <p className="text-slate-400 text-xs mb-8 line-clamp-2 leading-relaxed">{article.excerpt}</p>
              <div className="flex items-center justify-between pt-6 border-t border-slate-50 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                <span>{article.author}</span>
                <span className="font-mono text-sync-blue">V{article.version}</span>
              </div>
            </div>
          </div>
        ))}
        {articles.length === 0 && (
          <div className="col-span-full py-40 bg-white rounded-[3rem] border border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
             <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-slate-200 mb-6"><svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg></div>
             <h3 className="text-2xl font-display font-black text-slate-900">Cache Depleted</h3>
             <p className="text-slate-400 mt-2 text-sm">Initialize a Wi-Fi stream in the Sync Center.</p>
             <button onClick={() => setActiveView('sync')} className="mt-8 px-10 py-4 bg-sync-blue text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-blue-100 hover:scale-105 active:scale-95 transition-all">Go to Sync</button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans">
      <header className="sticky top-0 z-[100] bg-white/70 backdrop-blur-2xl border-b border-slate-200 h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => { if (session.isAuthenticated) { setActiveView('home'); setSelectedArticle(null); } }}>
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-sync-blue shadow-lg border border-slate-100">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block">
               <span className="text-2xl font-display font-black tracking-tighter leading-none">SyncFlow</span>
               <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1 block opacity-60">Professional Sync Engine</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} signalStrength={network.signalStrength} isMetered={network.isMetered} />
            {session.isAuthenticated && (
              <button onClick={handleLogout} className="group flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] font-black text-slate-900 uppercase leading-none">{session.user?.firstName}</div>
                  <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Logout</div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} alt="avatar" />
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-12 pb-32">
        {activeView === 'auth' && (
          <div className="min-h-[80vh] flex items-center justify-center">
            <div className="w-full max-w-lg bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 animate-slide-up relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-sync-blue/10 animate-flow-gradient"></div>
              
              <div className="flex flex-col items-center mb-10 text-center">
                <div className="w-20 h-20 bg-sync-blue rounded-3xl flex items-center justify-center text-white mb-6 shadow-xl animate-float">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h1 className="text-5xl font-display font-black tracking-tighter">SyncFlow</h1>
                <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px] mt-2 opacity-60">System Identity Gateway</p>
              </div>

              {errorMsg && <div className="mb-6 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest animate-pulse">{errorMsg}</div>}
              {authSuccessMsg && <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{authSuccessMsg}</div>}

              {authView === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email Address</label>
                    <input name="email" type="email" required placeholder="name@example.com" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Password</label>
                    <input name="password" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
                  </div>
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                    {authLoading ? 'Verifying...' : 'Engage'}
                  </button>
                  <div className="flex justify-center pt-4">
                    <button type="button" onClick={() => setAuthView('register')} className="text-[9px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest">Register New Node</button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <input name="firstName" required placeholder="First Name" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                    <input name="lastName" required placeholder="Last Name" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                  </div>
                  <input name="email" type="email" required placeholder="Email Address" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                  <input name="password" type="password" required placeholder="Password (8+ chars, Case, Sym, Num)" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                  <input name="confirmPassword" type="password" required placeholder="Confirm Password" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
                    {authLoading ? 'Provisioning...' : 'Register'}
                  </button>
                  <div className="text-center pt-4">
                    <button type="button" onClick={() => setAuthView('login')} className="text-[9px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest">Back to Login</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {session.isAuthenticated && activeView === 'home' && <HomeView />}

        {session.isAuthenticated && activeView === 'sync' && (
           <div className="animate-slide-up space-y-16 max-w-6xl mx-auto">
              <div className="text-center space-y-4 mb-20">
                <h2 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h2>
                <p className="text-slate-400 text-2xl font-medium">Telemetry and cloud-to-local bridging.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm space-y-10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-3xl font-display font-black text-sync-dark">Download Engine</h3>
                    <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>{downloadState}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <button onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} className="flex flex-col items-center justify-center gap-3 py-6 bg-sync-blue text-white rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-blue-50 disabled:opacity-30">Engage Uplink</button>
                    <button onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-50 text-slate-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-30">Pause Stream</button>
                    <button onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} className="flex flex-col items-center justify-center gap-3 py-6 bg-rose-50 text-rose-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all disabled:opacity-30">Abort</button>
                    <button onClick={handleSaveData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} className="flex flex-col items-center justify-center gap-3 py-6 bg-emerald-50 text-emerald-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all shadow-xl shadow-emerald-50 disabled:opacity-30">Commit ({downloadBuffer.length})</button>
                  </div>
                  {downloadState !== 'idle' && (
                     <div className="pt-10 border-t border-slate-50">
                        <ProgressBar progress={syncProgress} label={`Dynamic Byte Stream (${network.signalStrength}% Signal)`} />
                     </div>
                  )}
                </div>

                <div className="bg-sync-dark p-12 rounded-[4rem] text-white shadow-2xl space-y-12 flex flex-col justify-between">
                  <div>
                    <h3 className="text-3xl font-display font-black mb-6">Offline Protocol</h3>
                    <p className="text-slate-400 text-lg font-medium leading-relaxed opacity-80">Use local packets when cloud connectivity is unstable.</p>
                  </div>
                  <div className="space-y-4">
                    <button onClick={() => setOfflineState(s => s === 'active' ? 'idle' : 'active')} className={`w-full py-6 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.3em] transition-all shadow-xl ${offlineState === 'active' ? 'bg-rose-500 text-white' : 'bg-white text-sync-dark hover:scale-[1.02]'}`}>
                      {offlineState === 'active' ? 'Deactivate Offline' : 'Activate Offline Mode'}
                    </button>
                    <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-500 mt-4 pt-8 border-t border-slate-800">
                       <span>{stats.cachedCount} Packets in Local Cache</span>
                       <span className="font-mono text-sync-blue">Latency: 0.0ms</span>
                    </div>
                  </div>
                </div>
              </div>
           </div>
        )}

        {session.isAuthenticated && activeView === 'reader' && selectedArticle && (
           <div className="max-w-5xl mx-auto animate-slide-up">
              <button onClick={() => { setActiveView('home'); setAiSummary(null); }} className="mb-10 flex items-center gap-4 text-slate-400 hover:text-slate-900 font-bold transition-all">
                 <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm hover:bg-slate-50"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg></div>
                 Return to Hub
              </button>
              <article className="bg-white rounded-[4rem] border border-slate-200 overflow-hidden shadow-2xl">
                 <div className="relative h-[550px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-16 left-16 right-16">
                       <h1 className="text-6xl md:text-7xl font-display font-black text-white leading-none tracking-tight">{selectedArticle.title}</h1>
                       <div className="flex gap-4 mt-8">
                          <button onClick={handleSummarize} disabled={isSummarizing || network.status === NetworkStatus.OFFLINE} className="px-8 py-3 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-20">{isSummarizing ? 'Synthesizing...' : 'AI Summary'}</button>
                          <button onClick={() => simulateLocalChange(selectedArticle)} className="px-8 py-3 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all">Create Fork</button>
                       </div>
                    </div>
                 </div>
                 <div className="px-12 md:px-32 py-24">
                    {aiSummary && (
                      <div className="mb-16 p-10 bg-blue-50/50 border border-blue-100 rounded-[3rem] text-2xl font-bold text-slate-800 italic leading-relaxed animate-slide-up">
                        <span className="block text-[10px] font-black text-sync-blue uppercase tracking-widest mb-4 opacity-60">AI Synthesis</span>
                        "{aiSummary}"
                      </div>
                    )}
                    <div className="prose prose-slate prose-2xl max-w-none text-slate-700 leading-relaxed font-medium">
                       {selectedArticle.content.split('. ').map((p, i) => <p key={i} className="mb-10 opacity-90">{p}.</p>)}
                    </div>
                 </div>
              </article>
           </div>
        )}
      </main>

      {session.isAuthenticated && (
        <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
          <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-6 py-4 rounded-[3rem] shadow-2xl flex items-center gap-4 border border-slate-700">
            <button onClick={() => { setActiveView('home'); setSelectedArticle(null); }} className={`flex items-center gap-4 px-10 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'home' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}>
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
               <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${activeView === 'home' ? 'block' : 'hidden'}`}>Hub</span>
            </button>
            <button onClick={() => { setActiveView('sync'); setSelectedArticle(null); }} className={`flex items-center gap-4 px-10 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'sync' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}>
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${activeView === 'sync' ? 'block' : 'hidden'}`}>Sync</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};

export default App;
