// Data driver selection (DEC-001): real Supabase when configured, embedded local otherwise.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { createLocalClient } from './localDriver.js';

export const IS_LOCAL = !process.env.SUPABASE_URL;

export const db = IS_LOCAL
  ? createLocalClient()
  : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      // DEC-046: Node < 22 has no native WebSocket; supabase-js initializes a Realtime
      // client even though we use polling. Provide `ws` as the transport so it constructs.
      realtime: { transport: ws }
    });

export const MOCK_AUTH = process.env.ENABLE_MOCK_AUTH === 'true';
export const MOCK_WHATSAPP = process.env.ENABLE_MOCK_WHATSAPP !== 'false';