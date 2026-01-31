
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  // --- Refs ---
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const networkRef = useRef({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false, signalStrength: 100 });
  const retryCountRef = useRef(0);

  // --- States ---
  const [session, setSession] = useState<UserSession>({ user: null, isAuthenticated: false });
  const [activeView, setActiveView] = useState<View>('auth');
  const [authView, setAuthView] = useState<AuthView>('login');
  const [network, setNetwork] = useState({ status: NetworkStatus.ONLINE, speed: 10, isMetered: false, signalStrength: 100 });
  const [articles, setArticles] = useState<Article[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);
  
  // --- Sync Engine States ---
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [offlineState, setOfflineState] = useState<OfflineSessionState>('idle');
  const [syncProgress, setSyncProgress] = useState(0);
  const [stats, setStats] = useState<SyncStats>({ 
    totalCount: 0, cachedCount: 0, lastSync: null, storageUsed: '0 KB', 
    quotaUsedPercent: 0, transferSpeed: 0, categoryBreakdown: [],
    remainingDataSizeKb: 0, etaSeconds: 0
  });
  const [downloadBuffer, setDownloadBuffer] = useState<Article[]>([]);
  const [config, setConfig] = useState<SyncConfig>({
    autoSync: true, wifiOnly: true, maxStorageMb: 2000,
    preferredCategories: ['Technology', 'Design', 'Future', 'Networking'],
    categoryPriorities: { 'Technology': 'high', 'Design': 'medium', 'Future': 'medium', 'Networking': 'low' },
    smartSummaries: true, retryAttempts: 5
  });

  // --- UI Refresh ---
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

  // --- Auth Handlers ---
  const validatePassword = (pass: string) => {
    const minLength = pass.length >= 8;
    const hasNum = /[0-9]/.test(pass);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    const hasUpper = /[A-Z]/.test(pass);
    return minLength && hasNum && hasSpecial && hasUpper;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthLoading(true);
    
    const formData = new FormData(e.target as HTMLFormElement);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const { session: userSession, error } = await supabase.auth.signInWithPassword({ email, password });
    
    setAuthLoading(false);
    if (error) {
      setErrorMsg(error.message);
    } else if (userSession) {
      setSession(userSession);
      setActiveView('home');
      if (userSession.user) logSyncEvent(userSession.user.id, "Node engaged. Secure session established.");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthSuccessMsg(null);
    
    const formData = new FormData(e.target as HTMLFormElement);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;
    const terms = formData.get('terms') === 'on';

    // Validations
    if (!terms) return setErrorMsg("You must accept the Terms and Privacy Policy.");
    if (password !== confirmPassword) return setErrorMsg("Passwords do not match.");
    if (!validatePassword(password)) {
      return setErrorMsg("Password must be 8+ chars, with an uppercase letter, a number, and a special character.");
    }

    setAuthLoading(true);
    const { user, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { firstName, lastName }
      }
    });

    setAuthLoading(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setAuthSuccessMsg("Account created! Simulation: A verification link has been sent to your email. You can now login.");
      setAuthView('login');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAuthSuccessMsg(null);
    
    const formData = new FormData(e.target as HTMLFormElement);
    const email = formData.get('email') as string;

    setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setAuthLoading(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setAuthSuccessMsg("Verification link sent! Please check your inbox to reset your password.");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession({ user: null, isAuthenticated: false });
    setActiveView('auth');
    setAuthView('login');
    setSelectedArticle(null);
    setErrorMsg(null);
    setAuthSuccessMsg(null);
  };

  // --- Article Actions ---
  const handleSummarize = async () => {
    if (!selectedArticle) return;
    setIsSummarizing(true);
    setAiSummary(null);
    try {
      const summary = await getSmartSummary(selectedArticle);
      setAiSummary(summary);
    } catch (err) {
      setErrorMsg("Failed to generate AI summary.");
    } finally {
      setIsSummarizing(false);
    }
  };

  const simulateLocalChange = async (article: Article) => {
    const updated: Article = { 
      ...article, 
      hasLocalChanges: true, 
      content: article.content + "\n\n[LOCAL FORK: Data modified for offline optimization.]" 
    };
    await dbService.saveArticle(updated);
    setSelectedArticle(updated);
    refreshUI();
  };

  // --- Init Persistence ---
  useEffect(() => {
    const initApp = async () => {
      await dbService.init();
      const savedState = await dbService.getSyncState();
      if (savedState) {
        downloadIdxRef.current = savedState.idx || 0;
        downloadSourceRef.current = savedState.source || [];
        setDownloadBuffer(savedState.buffer || []);
        if (savedState.source?.length) {
          setSyncProgress((savedState.idx / savedState.source.length) * 100);
        }
      }
      refreshUI();
    };
    initApp();
  }, [refreshUI]);

  // --- Download Engine ---
  const handleStopDownload = useCallback(async () => {
    isDownloadingRef.current = false;
    setDownloadState('stopped');
    downloadIdxRef.current = 0;
    setDownloadBuffer([]);
    setSyncProgress(0);
    await dbService.clearSyncState();
    if (session.user) logSyncEvent(session.user.id, "Stream aborted. Progress reset.");
  }, [session.user]);

  const handlePauseDownload = useCallback(async () => {
    isDownloadingRef.current = false;
    setDownloadState('paused');
    await dbService.saveSyncState({
      idx: downloadIdxRef.current,
      source: downloadSourceRef.current,
      buffer: downloadBuffer
    });
    if (session.user) logSyncEvent(session.user.id, "Stream paused. Progress persisted.");
  }, [downloadBuffer, session.user]);

  const handleStartDownload = useCallback(async () => {
    if (downloadState === 'downloading') return;
    if (networkRef.current.status === NetworkStatus.OFFLINE) {
      setErrorMsg("Network unavailable. Check your uplink.");
      return;
    }
    setErrorMsg(null);
    setDownloadState('downloading');
    isDownloadingRef.current = true;

    try {
      if (downloadIdxRef.current === 0 || !downloadSourceRef.current.length) {
        const remote = await fetchArticlesFromCloud();
        const local = await dbService.getAllArticles();
        const updatesNeeded = remote.filter(rem => {
          const loc = local.find(l => l.id === rem.id);
          return !loc || rem.version > loc.version;
        });

        if (!updatesNeeded.length) {
          setDownloadState('completed');
          isDownloadingRef.current = false;
          return;
        }
        downloadSourceRef.current = updatesNeeded;
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
        const baseSpeed = 100 + (signal / 100) * 8000; // 100KB/s - 8MB/s
        const jitter = 0.8 + Math.random() * 0.4;
        const effectiveSpeed = baseSpeed * jitter;
        const delay = (article.sizeKb / effectiveSpeed) * 1000;

        await new Promise(r => setTimeout(r, Math.max(10, delay)));

        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        setSyncProgress((downloadIdxRef.current / downloadSourceRef.current.length) * 100);
        
        setStats(s => ({
          ...s,
          transferSpeed: effectiveSpeed,
          remainingDataSizeKb: downloadSourceRef.current.slice(downloadIdxRef.current).reduce((acc, a) => acc + a.sizeKb, 0),
          etaSeconds: (downloadSourceRef.current.slice(downloadIdxRef.current).reduce((acc, a) => acc + a.sizeKb, 0)) / effectiveSpeed
        }));

        syncLoop();
      };
      syncLoop();
    } catch (e) {
      setErrorMsg("Cloud uplink failed. Retrying...");
      if (retryCountRef.current < config.retryAttempts) {
        retryCountRef.current++;
        setTimeout(handleStartDownload, 3000);
      } else {
        setDownloadState('stopped');
        isDownloadingRef.current = false;
      }
    }
  }, [downloadState, config.retryAttempts]);

  const handleSaveDownloadedData = async () => {
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

  // --- Network Watcher ---
  const checkNetwork = useCallback(async () => {
    const q = await getNetworkQuality();
    const newState = { status: q.status, speed: q.estimatedSpeedMbps, isMetered: q.isMetered, signalStrength: q.signalStrength };
    setNetwork(newState);
    networkRef.current = newState;

    if (isDownloadingRef.current) {
      const degrade = q.status !== NetworkStatus.ONLINE || q.signalStrength < 15 || (config.wifiOnly && q.isMetered);
      if (degrade) {
        handlePauseDownload();
        if (session.user) logSyncEvent(session.user.id, "Stream auto-paused: Network Degradation.");
      }
    } else if (downloadState === 'paused' && q.status === NetworkStatus.ONLINE && q.signalStrength > 45 && (!config.wifiOnly || !q.isMetered)) {
      handleStartDownload();
    }
  }, [config.wifiOnly, downloadState, handlePauseDownload, handleStartDownload, session.user]);

  useEffect(() => {
    const timer = setInterval(checkNetwork, 2000);
    return () => clearInterval(timer);
  }, [checkNetwork]);

  // --- Render Helpers ---
  const Home = () => (
    <div className="animate-slide-up">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-12 mb-20">
        <div>
          <h2 className="text-7xl font-display font-black tracking-tighter text-sync-dark leading-none">Intelligence</h2>
          <p className="text-slate-400 mt-6 text-2xl font-medium">Hello, {session.user?.firstName}. {stats.cachedCount} nodes active on this machine.</p>
        </div>
        <div className="relative group w-full md:w-96">
          <input 
            type="text" placeholder="Filter packets..." 
            className="w-full bg-white border border-slate-200 rounded-[2rem] py-5 px-16 text-sm font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none shadow-sm"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          />
          <svg className="w-6 h-6 text-slate-300 absolute left-6 top-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
        {(offlineState === 'active' ? articles.filter(a => !!a.cachedAt) : articles).map(article => (
          <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[3.5rem] border border-slate-200/60 overflow-hidden cursor-pointer hover:shadow-2xl hover:-translate-y-3 transition-all duration-500">
            <div className="aspect-[16/11] relative overflow-hidden">
              <img src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" alt="cover" />
              <div className="absolute top-6 left-6 px-4 py-2 bg-white/90 backdrop-blur rounded-full text-[10px] font-black text-sync-dark uppercase tracking-[0.2em] shadow-sm">{article.category}</div>
              {article.hasLocalChanges && <div className="absolute bottom-6 right-6 px-4 py-2 bg-amber-400 rounded-full text-[9px] font-black text-white uppercase tracking-widest shadow-xl">FORKED</div>}
            </div>
            <div className="p-10">
              <h3 className="text-2xl font-display font-bold text-slate-900 mb-5 group-hover:text-sync-blue transition-colors line-clamp-2 leading-[1.2]">{article.title}</h3>
              <p className="text-slate-400 text-sm mb-10 line-clamp-2 leading-relaxed font-medium">{article.excerpt}</p>
              <div className="flex items-center justify-between pt-8 border-t border-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                 <span>{article.author}</span>
                 <span className="font-mono text-sync-blue">V{article.version}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const SyncConsole = () => (
    <div className="animate-slide-up space-y-16 max-w-6xl mx-auto">
      <div className="text-center space-y-6 mb-20">
        <h2 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h2>
        <p className="text-slate-400 text-2xl font-medium">Control panel for cloud-to-local telemetry.</p>
      </div>

      {errorMsg && <div className="p-6 bg-rose-50 border border-rose-100 text-rose-600 rounded-3xl font-bold text-center animate-pulse">{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Download Panel */}
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm space-y-10">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black text-sync-dark">Download (Wi-Fi)</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>{downloadState}</div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <button onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} className="flex flex-col items-center justify-center gap-3 py-6 bg-sync-blue text-white rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:scale-105 active:scale-95 transition-all shadow-xl shadow-blue-100 disabled:opacity-30">Download from Wi-Fi</button>
            <button onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-50 text-slate-600 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:bg-slate-100 transition-all disabled:opacity-30">Pause Download</button>
            <button onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} className="flex flex-col items-center justify-center gap-3 py-6 bg-rose-50 text-rose-600 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:bg-rose-100 transition-all disabled:opacity-30">Stop Download</button>
            <button onClick={handleSaveDownloadedData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} className="flex flex-col items-center justify-center gap-3 py-6 bg-emerald-50 text-emerald-600 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:bg-emerald-100 transition-all disabled:opacity-30">Save Data ({downloadBuffer.length})</button>
          </div>
          {downloadState !== 'idle' && (
             <div className="pt-10 border-t border-slate-50">
                <ProgressBar progress={syncProgress} label={`Wi-Fi Streaming (${network.signalStrength}% Signal)`} speed={stats.transferSpeed} eta={stats.etaSeconds} remainingKb={stats.remainingDataSizeKb} />
             </div>
          )}
        </div>

        {/* Offline Panel */}
        <div className="bg-sync-dark p-12 rounded-[4rem] text-white shadow-2xl space-y-10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black">Offline Usage</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-slate-700 ${offlineState === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500'}`}>{offlineState}</div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <button onClick={() => setOfflineState('active')} className={`flex flex-col items-center justify-center gap-3 py-6 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] transition-all ${offlineState === 'active' ? 'bg-emerald-500 text-white shadow-xl' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>Use Offline Data</button>
            <button onClick={() => setOfflineState('paused')} disabled={offlineState === 'idle'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:text-white transition-all disabled:opacity-30">Pause Offline Sync</button>
            <button onClick={() => setOfflineState('idle')} disabled={offlineState === 'idle'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:text-white transition-all disabled:opacity-30">Stop Session</button>
            <button onClick={() => alert("Changes queued for next uplink.")} disabled={offlineState !== 'active'} className="flex flex-col items-center justify-center gap-3 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-[0.3em] hover:text-white transition-all disabled:opacity-30">Save Changes</button>
          </div>
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 pt-10 border-t border-slate-800">
             <span>{stats.cachedCount} Packets in Cache</span>
             <span className="font-mono text-sync-blue">SYSTEM LATENCY: 0.00ms</span>
          </div>
        </div>
      </div>
    </div>
  );

  const AuthScreen = () => (
    <div className="min-h-[85vh] flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100 animate-slide-up overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-2 animate-flow-gradient"></div>
        
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="w-20 h-20 bg-sync-blue rounded-3xl flex items-center justify-center text-white mb-6 shadow-xl animate-float">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-5xl font-display font-black tracking-tighter">SyncFlow</h1>
          <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px] mt-2">
            {authView === 'login' ? 'Authentication Required' : authView === 'register' ? 'New Node Registration' : 'Account Recovery'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-xs font-bold animate-pulse flex items-center gap-3">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            {errorMsg}
          </div>
        )}

        {authSuccessMsg && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-2xl text-xs font-bold flex items-center gap-3">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {authSuccessMsg}
          </div>
        )}

        {authView === 'login' && (
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email Address</label>
              <input name="email" type="email" required placeholder="name@example.com" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Password</label>
              <input name="password" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
            </div>
            <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
              {authLoading ? 'Authenticating...' : 'Engage'}
            </button>
            <div className="flex flex-col gap-3 pt-4 items-center">
              <button type="button" onClick={() => setAuthView('register')} className="text-[10px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest underline underline-offset-4">Register New Account</button>
              <button type="button" onClick={() => setAuthView('forgot-password')} className="text-[10px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest underline underline-offset-4">Forgot Password?</button>
            </div>
          </form>
        )}

        {authView === 'register' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">First Name</label>
                <input name="firstName" type="text" required placeholder="John" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">Last Name</label>
                <input name="lastName" type="text" required placeholder="Doe" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">Email Address</label>
              <input name="email" type="email" required placeholder="name@example.com" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">Password</label>
                <input name="password" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">Confirm</label>
                <input name="confirmPassword" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
              </div>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Password Requirements:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-center gap-2 text-[8px] font-black text-slate-500 uppercase"><div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> 8+ Characters</div>
                <div className="flex items-center gap-2 text-[8px] font-black text-slate-500 uppercase"><div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> 1 Uppercase</div>
                <div className="flex items-center gap-2 text-[8px] font-black text-slate-500 uppercase"><div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> 1 Number</div>
                <div className="flex items-center gap-2 text-[8px] font-black text-slate-500 uppercase"><div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> 1 Symbol</div>
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <input name="terms" type="checkbox" required className="w-4 h-4 rounded border-slate-200 text-sync-blue focus:ring-sync-blue/5" />
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">I accept the Terms and Privacy Policy</span>
            </div>
            <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-4 rounded-2xl font-black uppercase tracking-[0.3em] text-xs shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
              {authLoading ? 'Registering...' : 'Initialize Node'}
            </button>
            <div className="pt-2 text-center">
              <button type="button" onClick={() => setAuthView('login')} className="text-[10px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest underline underline-offset-4">Back to Login</button>
            </div>
          </form>
        )}

        {authView === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="space-y-6">
            <p className="text-xs text-slate-400 text-center font-medium leading-relaxed px-4">
              Enter your email address and we'll send you a simulation link to reset your access credentials.
            </p>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email Address</label>
              <input name="email" type="email" required placeholder="name@example.com" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 font-bold outline-none" />
            </div>
            <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl disabled:opacity-50">
              {authLoading ? 'Processing...' : 'Send Recovery Link'}
            </button>
            <div className="text-center">
              <button type="button" onClick={() => setAuthView('login')} className="text-[10px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest underline underline-offset-4">Back to Login</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans">
      <header className="sticky top-0 z-[100] bg-white/70 backdrop-blur-2xl border-b border-slate-200/50 h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => { if (session.isAuthenticated) { setActiveView('home'); setSelectedArticle(null); } }}>
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-sync-blue shadow-xl border border-slate-100">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block">
               <span className="text-2xl font-display font-black tracking-tighter block leading-none">SyncFlow</span>
               <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1 block">Production Engine</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} signalStrength={network.signalStrength} isMetered={network.isMetered} />
            {session.isAuthenticated && (
              <button onClick={handleLogout} className="group flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] font-black text-slate-900 uppercase leading-none">{session.user?.firstName} {session.user?.lastName}</div>
                  <div className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Logout</div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden group-hover:border-rose-200 transition-colors">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} alt="" />
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-12 pb-32">
        {activeView === 'auth' && <AuthScreen />}

        {session.isAuthenticated && activeView === 'home' && <Home />}
        {session.isAuthenticated && activeView === 'sync' && <SyncConsole />}

        {session.isAuthenticated && activeView === 'reader' && selectedArticle && (
           <div className="max-w-5xl mx-auto animate-slide-up">
              <button onClick={() => { setActiveView('home'); setAiSummary(null); }} className="mb-12 flex items-center gap-4 text-slate-400 hover:text-slate-900 font-bold transition-all">
                 <div className="w-12 h-12 rounded-[1.5rem] bg-white border border-slate-200 flex items-center justify-center shadow-sm"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg></div>
                 Return to Hub
              </button>
              <article className="bg-white rounded-[4rem] border border-slate-200 overflow-hidden shadow-2xl">
                 <div className="relative h-[600px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
                    <div className="absolute bottom-20 left-20 right-20">
                       <h1 className="text-6xl md:text-8xl font-display font-black text-white leading-none tracking-tight">{selectedArticle.title}</h1>
                       <div className="flex gap-4 mt-8">
                          <button onClick={handleSummarize} disabled={isSummarizing || network.status === NetworkStatus.OFFLINE} className="px-8 py-3 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-20">AI Summarize</button>
                          <button onClick={() => simulateLocalChange(selectedArticle)} className="px-8 py-3 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[10px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all">Mock Edit</button>
                       </div>
                    </div>
                 </div>
                 <div className="px-12 md:px-32 py-24">
                    {aiSummary && <div className="mb-16 p-10 bg-blue-50/50 border border-blue-100 rounded-[2.5rem] text-2xl font-bold text-slate-800 italic leading-relaxed">"{aiSummary}"</div>}
                    <div className="prose prose-slate prose-2xl max-w-none text-slate-700 leading-relaxed">
                       {selectedArticle.content.split('. ').map((p, i) => <p key={i} className="mb-10">{p}.</p>)}
                    </div>
                 </div>
              </article>
           </div>
        )}
      </main>

      {session.isAuthenticated && (
        <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
          <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-6 py-4 rounded-[3rem] shadow-2xl flex items-center gap-4 border border-slate-700/50">
            <button onClick={() => { setActiveView('home'); setSelectedArticle(null); }} className={`flex items-center gap-4 px-8 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'home' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}>
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
               <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${activeView === 'home' ? 'block' : 'hidden'}`}>Hub</span>
            </button>
            <button onClick={() => { setActiveView('sync'); setSelectedArticle(null); }} className={`flex items-center gap-4 px-8 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'sync' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}>
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
