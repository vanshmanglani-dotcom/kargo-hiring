import { createClient } from '@supabase/supabase-js';

let client;
export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) not set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export async function getRubric() {
  const { data, error } = await db().from('rubric_criteria').select('*').order('role').order('position');
  if (error) throw error;
  if (!data?.length) throw new Error('rubric_criteria is empty — run supabase/schema.sql');
  return { PM: data.filter((c) => c.role === 'PM'), SPM: data.filter((c) => c.role === 'SPM') };
}
