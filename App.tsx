
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
  
  // --- Feedback States ---
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);
  // Fix: Added state for AI summaries
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState<Record<string, boolean>>({});
  
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

  // --- Engine Refs (Stability) ---
  const isDownloadingRef = useRef(false);
  const downloadIdxRef = useRef(0);
  const downloadSourceRef = useRef<Article[]>([]);
  const networkRef = useRef(network);
  const downloadStateRef = useRef<DownloadState>('idle');
  const configRef = useRef(config);

  useEffect(() => { networkRef.current = network; }, [network]);
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);
  useEffect(() => { configRef.current = config; }, [config]);

  // --- UI Refresh Action ---
  const refreshUI = useCallback(async () => {
    try {
      const items = await dbService.searchArticles(searchQuery);
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

  // --- Auth Handlers ---
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
      setErrorMsg(err.message || "Authentication failed.");
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
  };

  // Fix: Added AI summarization handler
  const handleSummarize = async (article: Article) => {
    if (summaries[article.id]) return;
    setLoadingSummaries(prev => ({ ...prev, [article.id]: true }));
    try {
      const summary = await getSmartSummary(article);
      setSummaries(prev => ({ ...prev, [article.id]: summary }));
    } catch (e) {
      console.error("Summarization error", e);
    } finally {
      setLoadingSummaries(prev => ({ ...prev, [article.id]: false }));
    }
  };

  // --- Sync Logic ---
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
        
        // Connectivity sensitivity logic
        const sensitivityMult = configRef.current.connectivitySensitivity === 'low' ? 0.5 : configRef.current.connectivitySensitivity === 'high' ? 1.5 : 1.0;
        const baseSpeed = (100 + (signal / 100) * 8000) * sensitivityMult;
        const delay = (article.sizeKb / baseSpeed) * 1000;

        await new Promise(r => setTimeout(r, Math.max(10, delay)));
        if (!isDownloadingRef.current) return;

        setDownloadBuffer(prev => [...prev, article]);
        downloadIdxRef.current++;
        setSyncProgress((downloadIdxRef.current / downloadSourceRef.current.length) * 100);
        
        setStats(prev => ({
          ...prev,
          transferSpeed: baseSpeed / 1024,
          remainingDataSizeKb: downloadSourceRef.current.slice(downloadIdxRef.current).reduce((acc, a) => acc + a.sizeKb, 0)
        }));

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
      details: `Committed ${itemsCount} items to local storage.`,
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
    if (window.confirm("Flush entire local intelligence core? This action is irreversible.")) {
      await dbService.clear();
      await dbService.addSyncLog({
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        type: 'manual',
        status: 'success',
        details: 'Local cache manual flush performed.',
        itemsSynced: 0
      });
      refreshUI();
    }
  };

  const toggleConfig = (key: keyof SyncConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateConfig = (key: keyof SyncConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // --- Lifecycle ---
  useEffect(() => {
    const initApp = async () => {
      await dbService.init();
      refreshUI();
    };
    initApp();
  }, [refreshUI]);

  useEffect(() => {
    const watcher = async () => {
      const q = await getNetworkQuality();
      setNetwork(prev => {
        if (prev.status !== q.status || 
            prev.signalStrength !== q.signalStrength || 
            prev.effectiveType !== q.effectiveType ||
            prev.isMetered !== q.isMetered) {
          
          if (isDownloadingRef.current) {
            const shouldPause = configRef.current.autoPauseWeak && (q.status !== NetworkStatus.ONLINE || q.signalStrength < 20 || (configRef.current.wifiOnly && q.isMetered));
            if (shouldPause) {
              handlePauseDownload();
              logSyncEvent(session.user?.id || 'guest', "Auto-paused: Connectivity degraded.");
            }
          } else if (downloadStateRef.current === 'paused' && configRef.current.autoResume) {
            const shouldResume = q.status === NetworkStatus.ONLINE && q.signalStrength > 50 && (!configRef.current.wifiOnly || !q.isMetered);
            if (shouldResume) {
              handleStartDownload();
              logSyncEvent(session.user?.id || 'guest', "Auto-resumed: Connectivity restored.");
            }
          }

          return { ...q, effectiveType: q.effectiveType };
        }
        return prev;
      });
    };
    const interval = setInterval(watcher, 3000);
    return () => clearInterval(interval);
  }, [handlePauseDownload, handleStartDownload, session.user]);

  // --- UI Layouts ---

  const HomeSyncView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h1>
        <p className="text-slate-400 text-2xl font-medium">Primary control for cloud-to-local bridging.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-10">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black text-sync-dark">Download Management</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              {downloadState}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-5">
            <button onClick={handleStartDownload} disabled={downloadState === 'downloading' || (network.status === NetworkStatus.OFFLINE)} className="flex flex-col items-center justify-center gap-2 py-6 bg-sync-blue text-white rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl disabled:opacity-30">Download via Wi-Fi</button>
            <button onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} className="flex flex-col items-center justify-center gap-2 py-6 bg-slate-50 text-slate-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-30">Pause Download</button>
            <button onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} className="flex flex-col items-center justify-center gap-2 py-6 bg-rose-50 text-rose-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-rose-100 transition-all disabled:opacity-30">Stop Download</button>
            <button onClick={handleSaveData} disabled={downloadBuffer.length === 0} className="flex flex-col items-center justify-center gap-2 py-6 bg-emerald-50 text-emerald-600 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all shadow-xl disabled:opacity-30">Save Data ({downloadBuffer.length})</button>
          </div>

          {(downloadState !== 'idle' || syncProgress > 0) && (
            <div className="pt-8 border-t border-slate-50">
              <ProgressBar progress={syncProgress} label={`Active stream: ${downloadState}`} speed={downloadState === 'downloading' ? (stats.transferSpeed || 0) * 1024 : 0} remainingKb={stats.remainingDataSizeKb} />
            </div>
          )}
        </div>

        <div className="bg-sync-dark p-10 rounded-[3rem] text-white shadow-2xl space-y-12 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-3xl font-display font-black">Offline Mode</h3>
              <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-slate-700 ${offlineState === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500'}`}>{offlineState}</div>
            </div>
            <p className="text-slate-400 text-lg font-medium opacity-80 mb-10">Access local data packets and queue changes while disconnected.</p>
            
            <div className="grid grid-cols-2 gap-5">
              <button onClick={() => setOfflineState('active')} disabled={offlineState === 'active'} className="flex flex-col items-center justify-center gap-2 py-6 bg-white text-sync-dark rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl disabled:opacity-30">Use Offline Data</button>
              <button onClick={() => setOfflineState('paused')} disabled={offlineState !== 'active'} className="flex flex-col items-center justify-center gap-2 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:text-white transition-all disabled:opacity-30">Pause Session</button>
              <button onClick={() => setOfflineState('idle')} disabled={offlineState === 'idle'} className="flex flex-col items-center justify-center gap-2 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:text-white transition-all disabled:opacity-30">Stop Session</button>
              <button onClick={() => alert("Changes saved locally.")} disabled={offlineState !== 'active'} className="flex flex-col items-center justify-center gap-2 py-6 bg-slate-800 text-slate-400 rounded-[2rem] text-[9px] font-black uppercase tracking-widest hover:text-white transition-all disabled:opacity-30">Save Changes</button>
            </div>
          </div>
          <div className="pt-8 border-t border-slate-800 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            <span>{stats.cachedCount} Packets in Cache</span>
            <span className="font-mono text-sync-blue">Latency: 0.0ms</span>
          </div>
        </div>
      </div>
      
      <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="space-y-1"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Connection</span><div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${network.status === NetworkStatus.ONLINE ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : network.status === NetworkStatus.WEAK ? 'bg-amber-500' : 'bg-rose-500'}`} /><span className="text-xl font-display font-bold text-slate-900 uppercase">{network.status}</span></div></div>
        <div className="space-y-1"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Strength</span><span className="text-xl font-display font-bold text-slate-900">{network.signalStrength}%</span></div>
        <div className="space-y-1"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Throughput</span><span className="text-xl font-display font-bold text-slate-900">{network.speed} Mbps</span></div>
        <div className="space-y-1"><span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Effective</span><span className="text-xl font-display font-bold text-slate-900 uppercase">{network.effectiveType}</span></div>
      </div>
    </div>
  );

  const SettingsView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto pb-20">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Administration</h1>
        <p className="text-slate-400 text-2xl font-medium">Configure network intelligence and secure your local hub.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Connectivity Card */}
        <div className="lg:col-span-2 space-y-8">
          <section className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-8">
            <h3 className="text-2xl font-display font-black text-sync-dark border-b border-slate-50 pb-6 flex items-center gap-3">
              <svg className="w-6 h-6 text-sync-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10.5 10.5 0 0114.142 0M1.414 8.414a15.5 15.5 0 0121.172 0" /></svg>
              Connectivity & Sync
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <ToggleRow label="Wi-Fi only downloads" description="Prevent data usage on cellular links." active={config.wifiOnly} onToggle={() => toggleConfig('wifiOnly')} />
              <ToggleRow label="Auto-sync (Strong Wi-Fi)" description="Bridge cloud when signal > 80%." active={config.autoSync} onToggle={() => toggleConfig('autoSync')} />
              <ToggleRow label="Auto-pause on weak signal" description="Protect battery and data integrity." active={config.autoPauseWeak} onToggle={() => toggleConfig('autoPauseWeak')} />
              <ToggleRow label="Auto-resume connectivity" description="Restart stream when signal improves." active={config.autoResume} onToggle={() => toggleConfig('autoResume')} />
              <ToggleRow label="Background Sync" description="Maintain uplink while app is minimized." active={config.backgroundSync} onToggle={() => toggleConfig('backgroundSync')} />
              <ToggleRow label="Metered Network Protection" description="Reduce throughput on restricted links." active={config.meteredProtection} onToggle={() => toggleConfig('meteredProtection')} />
              
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sync Priority</label>
                <select value={config.syncPriority} onChange={(e) => updateConfig('syncPriority', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-sync-blue/10">
                  <option value="low">Low Impact</option>
                  <option value="normal">Balanced Performance</option>
                  <option value="high">Maximum Throughput</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Connectivity Sensitivity</label>
                <select value={config.connectivitySensitivity} onChange={(e) => updateConfig('connectivitySensitivity', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-sync-blue/10">
                  <option value="low">Stable (Conservative)</option>
                  <option value="balanced">Standard</option>
                  <option value="high">Aggressive (Fastest)</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-8">
            <h3 className="text-2xl font-display font-black text-sync-dark border-b border-slate-50 pb-6 flex items-center gap-3">
              <svg className="w-6 h-6 text-sync-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3zM9 12h6M12 9v6" /></svg>
              Offline Storage
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="space-y-6">
                <div className="flex justify-between items-end"><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max Reservation</span><span className="font-mono text-xl font-bold text-sync-blue">{config.maxStorageMb} MB</span></div>
                <input type="range" min="500" max="5000" step="100" className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-sync-blue" value={config.maxStorageMb} onChange={(e) => updateConfig('maxStorageMb', parseInt(e.target.value))} />
                <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Current Usage:</span>
                  <span className="font-mono text-xs font-bold text-sync-dark">{stats.storageUsed} / {config.maxStorageMb} MB</span>
                </div>
              </div>
              <div className="space-y-8">
                <ToggleRow label="Auto-prune old packets" description="Delete data older than retention limit." active={config.autoDeleteOld} onToggle={() => toggleConfig('autoDeleteOld')} />
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Retention Period (Days)</label>
                  <input type="number" value={config.autoDeleteDurationDays} onChange={(e) => updateConfig('autoDeleteDurationDays', parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" disabled={!config.autoDeleteOld} />
                </div>
                <button onClick={handleClearCache} className="w-full py-4 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl font-black uppercase tracking-widest text-[9px] hover:bg-rose-600 hover:text-white transition-all">Flush Knowledge Core</button>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Settings */}
        <div className="space-y-8">
          <section className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-xl font-display font-black text-sync-dark border-b border-slate-50 pb-4">Security & Session</h3>
            <div className="space-y-6">
              <ToggleRow label="Encrypt Offline Data" description="AES-256 local encryption." active={config.encryptOffline} onToggle={() => toggleConfig('encryptOffline')} />
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Session Timeout (Min)</label>
                <input type="number" value={config.sessionTimeoutMinutes} onChange={(e) => updateConfig('sessionTimeoutMinutes', parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-sm outline-none" />
              </div>
              <button className="w-full py-3 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition-all">Update Credentials</button>
              <button onClick={() => alert("All other sessions terminated.")} className="w-full py-3 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 transition-all">Logout all devices</button>
            </div>
          </section>

          <section className="bg-sync-dark p-8 rounded-[2.5rem] shadow-xl space-y-6 text-white">
            <h3 className="text-xl font-display font-black border-b border-slate-800 pb-4">Advanced Tools</h3>
            <div className="space-y-6">
              <ToggleRow label="Debug Overlay" description="Enable verbose system telemetry." active={config.debugMode} onToggle={() => toggleConfig('debugMode')} />
              <button onClick={() => { handleStopDownload(); handleStartDownload(); }} className="w-full py-3 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs hover:bg-slate-700 transition-all">Force Full Re-sync</button>
              <button onClick={() => { dbService.clearSyncState(); window.location.reload(); }} className="w-full py-3 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs hover:bg-slate-700 transition-all">Reset Sync Engine</button>
              <div className="pt-4 border-t border-slate-800">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-4">Uplink Simulation</span>
                <div className="grid grid-cols-3 gap-2">
                  <button className="py-2 bg-slate-800 rounded-lg text-[8px] font-black uppercase">Slow</button>
                  <button className="py-2 bg-slate-800 rounded-lg text-[8px] font-black uppercase">Fast</button>
                  <button className="py-2 bg-slate-800 rounded-lg text-[8px] font-black uppercase">Edge</button>
                </div>
              </div>
            </div>
          </section>

          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
            <h3 className="text-xl font-display font-black text-sync-dark mb-6">Recent History</h3>
            <div className="space-y-4">
              {logs.slice(0, 3).map(log => (
                <div key={log.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <div className={`w-1.5 h-1.5 rounded-full ${log.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <div className="flex-1 overflow-hidden">
                    <div className="text-[8px] font-black text-slate-400 uppercase truncate">{log.details}</div>
                    <div className="text-[7px] font-bold text-slate-300 uppercase">{new Date(log.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
              <button onClick={() => setActiveView('home')} className="w-full text-center text-[9px] font-black uppercase tracking-widest text-sync-blue hover:underline">View All Logs</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );

  // Fix: Implemented missing LibraryView component to resolve 'Cannot find name LibraryView'
  const LibraryView = () => (
    <div className="animate-slide-up space-y-12 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
        <div className="space-y-4">
          <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Intelligence</h1>
          <p className="text-slate-400 text-2xl font-medium uppercase tracking-widest opacity-60">Local Knowledge Core / {articles.length} Packets</p>
        </div>
        <div className="relative w-full md:w-96 group">
          <input 
            type="text" 
            placeholder="Query memory banks..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border-2 border-slate-100 rounded-3xl px-8 py-5 font-bold text-lg focus:ring-4 focus:ring-sync-blue/5 focus:border-sync-blue outline-none transition-all shadow-lg"
          />
          <svg className="w-6 h-6 absolute right-8 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-sync-blue transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {articles.map(article => (
          <div key={article.id} className="group bg-white rounded-[3rem] border border-slate-200 overflow-hidden shadow-sm hover:shadow-2xl hover:-translate-y-2 transition-all duration-500 flex flex-col">
            <div className="relative h-64 overflow-hidden">
              <img src={article.imageUrl} alt={article.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
              <div className="absolute top-6 left-6">
                <span className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest text-white shadow-lg ${article.importance === 'high' ? 'bg-rose-500' : article.importance === 'medium' ? 'bg-amber-500' : 'bg-slate-500'}`}>
                  {article.importance} priority
                </span>
              </div>
              <div className="absolute bottom-6 left-6 flex gap-2">
                 <span className="px-3 py-1 bg-white/90 backdrop-blur-md rounded-lg text-[8px] font-black uppercase tracking-widest text-slate-900">{article.category}</span>
              </div>
            </div>
            <div className="p-10 flex-1 flex flex-col">
              <h3 className="text-2xl font-display font-black text-sync-dark mb-4 leading-tight group-hover:text-sync-blue transition-colors line-clamp-2">{article.title}</h3>
              <p className="text-slate-500 text-sm font-medium line-clamp-3 mb-8 leading-relaxed">{article.excerpt}</p>
              
              {summaries[article.id] && (
                <div className="mb-8 p-6 bg-blue-50/50 border border-blue-100 rounded-2xl animate-slide-up">
                  <span className="text-[8px] font-black text-sync-blue uppercase tracking-widest block mb-2">AI Intelligence Summary</span>
                  <p className="text-xs font-bold text-slate-700 italic leading-relaxed">"{summaries[article.id]}"</p>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-4 pt-8 border-t border-slate-50">
                <button 
                  onClick={() => { setSelectedArticle(article); setActiveView('reader'); }}
                  className="flex-1 bg-sync-dark text-white py-4 rounded-2xl text-[9px] font-black uppercase tracking-widest hover:bg-sync-blue transition-all shadow-lg active:scale-95"
                >
                  Open Packet
                </button>
                {config.smartSummaries && (
                  <button 
                    onClick={() => handleSummarize(article)}
                    disabled={loadingSummaries[article.id]}
                    className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 hover:bg-white hover:text-sync-blue hover:border-sync-blue transition-all disabled:opacity-30"
                    title="Generate AI Summary"
                  >
                    {loadingSummaries[article.id] ? (
                      <div className="w-4 h-4 border-2 border-sync-blue border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {articles.length === 0 && (
          <div className="col-span-full py-32 text-center space-y-6">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            </div>
            <p className="text-xl font-display font-black text-slate-400 uppercase tracking-widest">Knowledge cores offline</p>
            <button onClick={() => setActiveView('home')} className="text-sync-blue font-black uppercase tracking-widest text-[10px] hover:underline">Sync with Cloud Now</button>
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
                  <div className="space-y-1.5"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email Address</label><input name="email" type="email" required placeholder="name@example.com" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Password</label><input name="password" type="password" required placeholder="••••••••" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" /></div>
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">{authLoading ? 'Verifying...' : 'Engage'}</button>
                  <div className="flex justify-center pt-4"><button type="button" onClick={() => setAuthView('register')} className="text-[9px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest">Register New Node</button></div>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4"><input name="firstName" required placeholder="First Name" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" /><input name="lastName" required placeholder="Last Name" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" /></div>
                  <input name="email" type="email" required placeholder="Email Address" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" /><input name="password" type="password" required placeholder="Password (8+ chars)" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" /><input name="confirmPassword" type="password" required placeholder="Confirm Password" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm outline-none" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-5 rounded-3xl font-black uppercase tracking-[0.3em] text-xs shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">{authLoading ? 'Provisioning...' : 'Register'}</button>
                  <div className="text-center pt-4"><button type="button" onClick={() => setAuthView('login')} className="text-[9px] font-bold text-slate-400 hover:text-sync-blue transition-colors uppercase tracking-widest">Back to Login</button></div>
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
              <button onClick={() => { setActiveView('library'); }} className="mb-10 flex items-center gap-4 text-slate-400 hover:text-slate-900 font-bold transition-all"><div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm hover:bg-slate-50"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg></div>Return to Library</button>
              <article className="bg-white rounded-[4rem] border border-slate-200 overflow-hidden shadow-2xl">
                 <div className="relative h-[550px]"><img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" /><div className="absolute bottom-16 left-16 right-16"><h1 className="text-6xl md:text-7xl font-display font-black text-white leading-none tracking-tight">{selectedArticle.title}</h1></div></div>
                 <div className="px-12 md:px-32 py-24"><div className="prose prose-slate prose-2xl max-w-none text-slate-700 leading-relaxed font-medium">{selectedArticle.content.split('. ').map((p, i) => <p key={i} className="mb-10 opacity-90">{p}.</p>)}</div></div>
              </article>
           </div>
        )}
      </main>

      {session.isAuthenticated && (
        <nav className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
          <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-6 py-4 rounded-[3rem] shadow-2xl flex items-center gap-2 border border-slate-700">
            <button onClick={() => { setActiveView('home'); setSelectedArticle(null); }} className={`flex items-center gap-3 px-8 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'home' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg><span className={`text-[9px] font-black uppercase tracking-widest ${activeView === 'home' ? 'block' : 'hidden'}`}>Sync</span></button>
            <button onClick={() => { setActiveView('library'); setSelectedArticle(null); }} className={`flex items-center gap-3 px-8 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'library' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg><span className={`text-[9px] font-black uppercase tracking-widest ${activeView === 'library' ? 'block' : 'hidden'}`}>Library</span></button>
            <button onClick={() => { setActiveView('settings'); setSelectedArticle(null); }} className={`flex items-center gap-3 px-8 py-3 rounded-[2rem] transition-all duration-500 ${activeView === 'settings' ? 'bg-white text-sync-dark shadow-xl' : 'text-slate-500 hover:text-white'}`}><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg><span className={`text-[9px] font-black uppercase tracking-widest ${activeView === 'settings' ? 'block' : 'hidden'}`}>Admin</span></button>
          </div>
        </nav>
      )}
    </div>
  );
};

// --- Helper Component ---
const ToggleRow = ({ label, description, active, onToggle }: { label: string, description: string, active: boolean, onToggle: () => void }) => (
  <div className="flex items-center justify-between gap-4 group">
    <div className="flex-1">
      <div className="text-sm font-black text-slate-900 group-hover:text-sync-blue transition-colors">{label}</div>
      <div className="text-[10px] text-slate-400 font-medium leading-tight mt-1">{description}</div>
    </div>
    <button onClick={onToggle} className={`w-12 h-6 rounded-full relative transition-all duration-300 ${active ? 'bg-sync-blue shadow-[0_0_10px_rgba(11,95,255,0.3)]' : 'bg-slate-200'}`}>
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-300 ${active ? 'left-7' : 'left-1'}`} />
    </button>
  </div>
);

export default App;
