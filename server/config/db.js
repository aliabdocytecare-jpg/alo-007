// Data driver (DEC-054): Supabase is the SINGLE source of truth for every environment.
// The embedded SQLite stand-in was removed — one database, one Express logic layer.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (DEC-054).');
  console.error('Set them in server/.env locally, or in the Coolify environment for production.');
  console.error('Use the service_role key: RLS is deny-all, so anon/authenticated cannot read or write.');
  process.exit(1);
}

export const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // DEC-046: Node < 22 has no native WebSocket; supabase-js initializes a Realtime
  // client even though we use polling. Provide `ws` as the transport so it constructs.
  realtime: { transport: ws }
});

export const MOCK_AUTH = process.env.ENABLE_MOCK_AUTH === 'true';
export const MOCK_WHATSAPP = process.env.ENABLE_MOCK_WHATSAPP !== 'false';
