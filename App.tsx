
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

  // --- Engine Refs (To avoid closure issues and stabilize effects) ---
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

  // --- Auth logic ---
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

  // --- Logic for Offline Session ---
  const handleSaveOfflineChanges = async () => {
    if (offlineState !== 'active') return;
    await dbService.addSyncLog({
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      type: 'manual',
      status: 'success',
      details: 'Offline changes saved to persistent local buffer.',
      itemsSynced: 0
    });
    alert("Local changes committed to disk.");
  };

  // --- Config Helpers ---
  const toggleConfig = (key: keyof SyncConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateConfig = (key: keyof SyncConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // --- Lifecycle Hooks ---
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
              logSyncEvent(session.user?.id || 'guest', "Auto-paused: Connection quality alert.");
            }
          } else if (downloadStateRef.current === 'paused' && configRef.current.autoResume) {
            const shouldResume = q.status === NetworkStatus.ONLINE && q.signalStrength > 50 && (!configRef.current.wifiOnly || !q.isMetered);
            if (shouldResume) {
              handleStartDownload();
              logSyncEvent(session.user?.id || 'guest', "Auto-resumed: Connection quality restored.");
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

  // --- UI Components ---

  const HomeSyncView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Sync Center</h1>
        <p className="text-slate-400 text-2xl font-medium">Professional data bridging and telemetry hub.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Core Controls */}
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-10">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black text-sync-dark">Download Controls</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${downloadState === 'downloading' ? 'bg-blue-50 border-blue-200 text-sync-blue animate-pulse' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              {downloadState}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <SyncActionButton onClick={handleStartDownload} disabled={downloadState === 'downloading' || network.status === NetworkStatus.OFFLINE} label="Download via Wi-Fi" variant="blue" />
            <SyncActionButton onClick={handlePauseDownload} disabled={downloadState !== 'downloading'} label="Pause Download" variant="slate" />
            <SyncActionButton onClick={handleStopDownload} disabled={downloadState === 'idle' || downloadState === 'completed'} label="Stop Download" variant="rose" />
            <SyncActionButton onClick={handleSaveData} disabled={downloadBuffer.length === 0 || downloadState === 'saving'} label={`Save Data (${downloadBuffer.length})`} variant="emerald" />
          </div>

          {(downloadState !== 'idle' || syncProgress > 0) && (
            <div className="pt-8 border-t border-slate-50">
              <ProgressBar progress={syncProgress} label={`Streaming: ${downloadState}`} speed={downloadState === 'downloading' ? (stats.transferSpeed || 0) * 1024 : 0} remainingKb={stats.remainingDataSizeKb} />
            </div>
          )}
        </div>

        {/* Offline Management */}
        <div className="bg-sync-dark p-10 rounded-[3rem] text-white shadow-2xl space-y-10 flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="text-3xl font-display font-black">Offline Session</h3>
            <div className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-slate-700 ${offlineState === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500'}`}>{offlineState}</div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <SyncActionButton onClick={() => setOfflineState('active')} disabled={offlineState === 'active'} label="Use Offline Data" variant="white" />
            <SyncActionButton onClick={() => setOfflineState('paused')} disabled={offlineState !== 'active'} label="Pause Session" variant="dark" />
            <SyncActionButton onClick={() => setOfflineState('idle')} disabled={offlineState === 'idle'} label="Stop Session" variant="dark" />
            <SyncActionButton onClick={handleSaveOfflineChanges} disabled={offlineState !== 'active'} label="Save Changes" variant="dark" />
          </div>

          <div className="mt-auto pt-8 border-t border-slate-800 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            <span>{stats.cachedCount} Packets in Local Cache</span>
            <span className="font-mono text-sync-blue">IO Latency: 0.2ms</span>
          </div>
        </div>
      </div>

      {/* Real-time Network Telemetry */}
      <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-display font-black text-sync-dark mb-8">Network Diagnostics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
          <TelemetryItem label="Effective Type" value={network.effectiveType.toUpperCase()} />
          <TelemetryItem label="Estimated Speed" value={`${network.speed} Mbps`} />
          <TelemetryItem label="Metered Link" value={network.isMetered ? 'Yes' : 'No'} color={network.isMetered ? 'text-amber-500' : 'text-emerald-500'} />
          <TelemetryItem label="Signal Strength" value={`${network.signalStrength}%`} />
        </div>
      </div>

      {/* Sync Log History */}
      <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-display font-black text-sync-dark mb-8">Uplink Activity Log</h3>
        <div className="space-y-4 max-h-80 overflow-y-auto pr-4 scroll-smooth">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-100 group transition-all hover:bg-white hover:shadow-md">
              <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${log.status === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-rose-500'}`} />
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{new Date(log.timestamp).toLocaleString()}</span>
                  <span className="text-[10px] font-bold text-sync-blue uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded">{log.type}</span>
                </div>
                <p className="text-sm font-bold text-slate-800 leading-tight">{log.details}</p>
                {log.itemsSynced > 0 && <span className="text-[9px] font-mono font-bold text-slate-400 mt-2 block">{log.itemsSynced} items bridged.</span>}
              </div>
            </div>
          ))}
          {logs.length === 0 && <div className="py-20 text-center text-slate-300 font-bold uppercase tracking-widest text-xs">No synchronization history found.</div>}
        </div>
      </div>
    </div>
  );

  const SettingsView = () => (
    <div className="animate-slide-up space-y-12 max-w-6xl mx-auto pb-24">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Administration</h1>
        <p className="text-slate-400 text-2xl font-medium">Manage system resources and uplink protocols.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* Main Settings Panel */}
        <div className="lg:col-span-2 space-y-10">
          <section className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-sm space-y-10">
            <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8 flex items-center gap-4">
              <svg className="w-8 h-8 text-sync-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              Storage & Caching
            </h3>
            
            <div className="space-y-10">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">System Quota</span>
                  <div className="text-4xl font-display font-black text-sync-blue">{stats.storageUsed} <span className="text-slate-200 text-2xl">/ {config.maxStorageMb} MB</span></div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Prune Buffer</span>
                  <button onClick={handleClearCache} className="px-6 py-3 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all">Clear Cache</button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center"><span className="text-xs font-black uppercase tracking-widest text-slate-700">Storage Limit</span><span className="font-mono text-sm font-bold text-sync-blue">{config.maxStorageMb} MB</span></div>
                <input type="range" min="500" max="10000" step="100" className="w-full h-2 bg-slate-100 rounded-full appearance-none cursor-pointer accent-sync-blue" value={config.maxStorageMb} onChange={(e) => updateConfig('maxStorageMb', parseInt(e.target.value))} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-slate-50">
                {stats.categoryBreakdown.map((b) => (
                  <div key={b.category} className="space-y-3 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-800">{b.category}</span>
                      <span className="font-mono text-[10px] font-bold text-slate-400">{(b.sizeKb / 1024).toFixed(1)} MB</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div className="h-full bg-sync-blue rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (b.sizeKb / (config.maxStorageMb * 10.24)) * 100)}%` }} />
                    </div>
                    <div className="text-[9px] font-bold text-slate-400">{b.count} Packets</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-white p-12 rounded-[3.5rem] border border-slate-200 shadow-sm space-y-10">
            <h3 className="text-3xl font-display font-black text-sync-dark border-b border-slate-50 pb-8 flex items-center gap-4">
              <svg className="w-8 h-8 text-sync-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10.5 10.5 0 0114.142 0M1.414 8.414a15.5 15.5 0 0121.172 0" /></svg>
              Network Protocol
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
              <ToggleRow label="Wi-Fi only downloads" description="Lock sync to unmetered connections." active={config.wifiOnly} onToggle={() => toggleConfig('wifiOnly')} />
              <ToggleRow label="Auto-pause weak signal" description="Protect session integrity." active={config.autoPauseWeak} onToggle={() => toggleConfig('autoPauseWeak')} />
              <ToggleRow label="Auto-resume connection" description="Restore uplink dynamically." active={config.autoResume} onToggle={() => toggleConfig('autoResume')} />
              <ToggleRow label="Auto-prune old packets" description="Delete aged data automatically." active={config.autoDeleteOld} onToggle={() => toggleConfig('autoDeleteOld')} />
            </div>
          </section>
        </div>

        {/* Sidebar Controls */}
        <div className="space-y-10">
          <section className="bg-sync-dark p-10 rounded-[3rem] text-white shadow-2xl space-y-8">
            <h3 className="text-2xl font-display font-black border-b border-slate-800 pb-6">Account & Security</h3>
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} className="w-12 h-12 rounded-xl" alt="user" />
                <div className="overflow-hidden">
                  <div className="text-sm font-black truncate">{session.user?.firstName} {session.user?.lastName}</div>
                  <div className="text-[10px] text-slate-400 truncate uppercase tracking-widest">{session.user?.email}</div>
                </div>
              </div>
              <ToggleRow label="Encrypted Offline Hub" description="AES-256 local protection." active={config.encryptOffline} onToggle={() => toggleConfig('encryptOffline')} inverted />
              <button onClick={handleLogout} className="w-full py-4 bg-rose-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-all shadow-xl shadow-rose-900/20">Deauthorize Device</button>
            </div>
          </section>

          <section className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm space-y-8">
            <h3 className="text-2xl font-display font-black text-sync-dark border-b border-slate-50 pb-6">Advanced</h3>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sync Priority</label>
                <select value={config.syncPriority} onChange={(e) => updateConfig('syncPriority', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-xs outline-none">
                  <option value="low">Efficiency (Low)</option>
                  <option value="normal">Balanced (Normal)</option>
                  <option value="high">Urgent (High)</option>
                </select>
              </div>
              <button onClick={() => { handleStopDownload(); handleStartDownload(); }} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all">Force Re-Sync</button>
              <button onClick={() => window.location.reload()} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all">Reset Sync Flow</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  const LibraryView = () => (
    <div className="animate-slide-up space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h2 className="text-8xl font-display font-black tracking-tighter text-sync-dark leading-none">Library</h2>
          <p className="text-slate-400 mt-4 text-2xl font-medium uppercase tracking-widest opacity-60">{stats.cachedCount} Packets available offline</p>
        </div>
        <div className="relative w-full md:w-96">
          <input type="text" placeholder="Search knowledge..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white border border-slate-200 rounded-3xl py-5 px-10 text-lg font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none shadow-lg transition-all" />
          <svg className="w-6 h-6 text-slate-300 absolute right-8 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
        {articles.map(article => (
          <div key={article.id} onClick={() => { setSelectedArticle(article); setActiveView('reader'); }} className="group bg-white rounded-[3rem] border border-slate-200 overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-500">
            <div className="aspect-[4/3] relative overflow-hidden">
              <img src={article.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="cover" />
              <div className="absolute top-6 left-6 px-4 py-1.5 bg-white/90 backdrop-blur rounded-full text-[10px] font-black text-sync-dark uppercase tracking-widest shadow-sm">{article.category}</div>
            </div>
            <div className="p-10">
              <h3 className="text-2xl font-display font-black text-slate-900 mb-4 group-hover:text-sync-blue transition-colors line-clamp-2 leading-tight">{article.title}</h3>
              <p className="text-slate-500 text-sm mb-10 line-clamp-3 leading-relaxed font-medium">{article.excerpt}</p>
              
              {summaries[article.id] && (
                <div className="mb-8 p-6 bg-blue-50/50 border border-blue-100 rounded-2xl animate-slide-up">
                  <span className="text-[8px] font-black text-sync-blue uppercase tracking-widest block mb-1">AI Intelligence Summary</span>
                  <p className="text-[11px] font-bold text-slate-700 italic leading-relaxed">"{summaries[article.id]}"</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-8 border-t border-slate-50">
                 <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-900 uppercase leading-none">{article.author}</span>
                    <span className="text-[8px] font-bold text-slate-300 uppercase mt-1">{article.date}</span>
                 </div>
                 <div className="flex gap-2">
                    <span className={`w-3 h-3 rounded-full ${article.importance === 'high' ? 'bg-rose-500' : article.importance === 'medium' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                 </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sync-light flex flex-col font-sans">
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-2xl border-b border-slate-200 h-20">
        <div className="max-w-7xl mx-auto px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => { if (session.isAuthenticated) { setActiveView('home'); setSelectedArticle(null); } }}>
            <div className="w-12 h-12 bg-sync-blue rounded-2xl flex items-center justify-center text-white shadow-xl">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="hidden sm:block leading-none">
               <span className="text-2xl font-display font-black tracking-tighter">SyncFlow</span>
               <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1 block">V2.0 Core</span>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <NetworkStatusBadge status={network.status} effectiveType={`${network.speed}Mbps`} signalStrength={network.signalStrength} isMetered={network.isMetered} />
            {session.isAuthenticated && (
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shadow-sm">
                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user?.email}`} alt="avatar" />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-10 py-16 pb-32">
        {activeView === 'auth' && (
          <div className="min-h-[70vh] flex items-center justify-center">
            <div className="w-full max-w-lg bg-white p-16 rounded-[4rem] shadow-2xl border border-slate-100 animate-slide-up relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-sync-blue"></div>
              <div className="flex flex-col items-center mb-12 text-center">
                <h1 className="text-6xl font-display font-black tracking-tighter">SyncFlow</h1>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-4 opacity-60">Authentication Protocol</p>
              </div>
              {errorMsg && <div className="mb-8 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-2xl text-[10px] font-black uppercase tracking-widest animate-pulse">{errorMsg}</div>}
              {authSuccessMsg && <div className="mb-8 p-4 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-2xl text-[10px] font-black uppercase tracking-widest">{authSuccessMsg}</div>}
              {authView === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-8">
                  <AuthField name="email" type="email" label="Access Key (Email)" placeholder="name@domain.com" />
                  <AuthField name="password" type="password" label="System Password" placeholder="••••••••" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-blue-200 hover:scale-[1.02] active:scale-95 transition-all">
                    {authLoading ? 'Authorizing...' : 'Engage Access'}
                  </button>
                  <button type="button" onClick={() => setAuthView('register')} className="w-full text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-sync-blue">Register New Node</button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <AuthField name="firstName" label="First Name" placeholder="Jane" />
                    <AuthField name="lastName" label="Last Name" placeholder="Doe" />
                  </div>
                  <AuthField name="email" type="email" label="Email Address" placeholder="name@domain.com" />
                  <AuthField name="password" type="password" label="Password" placeholder="••••••••" />
                  <AuthField name="confirmPassword" type="password" label="Confirm" placeholder="••••••••" />
                  <button type="submit" disabled={authLoading} className="w-full bg-sync-blue text-white py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs shadow-2xl hover:scale-105 transition-all">Register Node</button>
                  <button type="button" onClick={() => setAuthView('login')} className="w-full text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-sync-blue">Back to Login</button>
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
              <button onClick={() => { setActiveView('library'); }} className="mb-10 flex items-center gap-6 text-slate-500 hover:text-slate-900 font-bold transition-all group">
                 <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-sm group-hover:shadow-lg"><svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" /></svg></div>
                 <span className="text-lg">Return to Library</span>
              </button>
              <article className="bg-white rounded-[5rem] border border-slate-200 overflow-hidden shadow-2xl">
                 <div className="relative h-[600px]">
                    <img src={selectedArticle.imageUrl} className="w-full h-full object-cover" alt="cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                    <div className="absolute bottom-20 left-20 right-20">
                       <h1 className="text-7xl font-display font-black text-white leading-none tracking-tight">{selectedArticle.title}</h1>
                       <div className="flex gap-4 mt-10">
                          <button onClick={() => handleSummarize(selectedArticle)} className="px-10 py-4 bg-white/10 backdrop-blur-3xl border border-white/20 rounded-full text-[11px] font-black text-white uppercase tracking-widest hover:bg-white/20 transition-all">AI Summarize</button>
                       </div>
                    </div>
                 </div>
                 <div className="px-20 md:px-40 py-24">
                    {summaries[selectedArticle.id] && (
                      <div className="mb-16 p-12 bg-blue-50/80 border border-blue-100 rounded-[3rem] text-3xl font-display font-bold text-slate-800 italic leading-relaxed animate-slide-up">
                        <span className="block text-[10px] font-black text-sync-blue uppercase tracking-widest mb-6 opacity-60">AI Synthetic Intel</span>
                        "{summaries[selectedArticle.id]}"
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
          <div className="pointer-events-auto bg-sync-dark/95 backdrop-blur-3xl px-8 py-5 rounded-[3rem] shadow-2xl flex items-center gap-4 border border-slate-700">
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
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600 shadow-emerald-100',
    white: 'bg-white text-sync-dark',
    dark: 'bg-slate-800 text-slate-300'
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`py-6 rounded-3xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-xl disabled:opacity-20 ${styles[variant]}`}>
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
  <div className="space-y-2">
    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">{label}</label>
    <input name={name} type={type} required placeholder={placeholder} className="w-full bg-slate-50 border border-slate-100 rounded-3xl px-8 py-5 font-bold focus:ring-4 focus:ring-sync-blue/5 outline-none transition-all" />
  </div>
);

const NavButton = ({ icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button onClick={onClick} className={`flex items-center gap-4 px-10 py-4 rounded-[2rem] transition-all duration-500 ${active ? 'bg-white text-sync-dark shadow-2xl scale-105' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}>
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
