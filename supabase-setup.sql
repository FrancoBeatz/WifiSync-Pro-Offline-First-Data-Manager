
-- Enable RLS
ALTER TABLE auth.users REPLICA IDENTITY FULL;

-- Knowledge Packets Table
CREATE TABLE IF NOT EXISTS public.articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT,
    author TEXT,
    date TEXT,
    image_url TEXT,
    category TEXT,
    importance TEXT,
    size_kb INTEGER,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync Sessions Table
CREATE TABLE IF NOT EXISTS public.sync_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'idle',
    progress INTEGER DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync Logs Table
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    type TEXT,
    status TEXT,
    details TEXT,
    items_synced INTEGER DEFAULT 0
);

-- Row Level Security
ALTER TABLE public.sync_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own sessions" ON public.sync_sessions
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own logs" ON public.sync_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view articles" ON public.articles
    FOR SELECT USING (true);

-- Indexes
CREATE INDEX idx_articles_category ON public.articles(category);
CREATE INDEX idx_sessions_user ON public.sync_sessions(user_id);
