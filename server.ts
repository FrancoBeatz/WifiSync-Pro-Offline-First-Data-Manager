
import express from 'express';
import cors from 'cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.39.0';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Client (Service Role for backend bypass RLS if needed, or Anon for user context)
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

app.use(cors());
app.use(express.json());

// --- Middleware: Verify Supabase JWT ---
const authenticate = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'Unauthorized node' });
  req.user = user;
  next();
};

// --- Routes ---

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'active', node: 'SyncFlow-Primary' }));

// Articles Delta Fetch
app.get('/api/articles', async (req, res) => {
  const { data, error } = await supabase.from('articles').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Start Sync Session
app.post('/api/sync/session', authenticate, async (req: any, res: any) => {
  const { totalItems } = req.body;
  const { data, error } = await supabase
    .from('sync_sessions')
    .insert([{ 
      user_id: req.user.id, 
      status: 'downloading', 
      total_items: totalItems,
      progress: 0 
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Update Progress
app.patch('/api/sync/session/:id', authenticate, async (req: any, res: any) => {
  const { id } = req.params;
  const { progress, status } = req.body;

  const { data, error } = await supabase
    .from('sync_sessions')
    .update({ progress, status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Post Logs
app.post('/api/sync/log', authenticate, async (req: any, res: any) => {
  const { type, status, details, itemsSynced } = req.body;
  
  const { error } = await supabase
    .from('sync_logs')
    .insert([{
      user_id: req.user.id,
      type,
      status,
      details,
      items_synced: itemsSynced
    }]);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`[SyncFlow Backend] Node active on port ${PORT}`));
