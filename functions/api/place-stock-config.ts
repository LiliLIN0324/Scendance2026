export interface PlaceStockEnv {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export function placeStockConfig(env: PlaceStockEnv) {
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  const db = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || 'https://wkhfvnzgopjdzxlmycks.supabase.co';
  return {
    url: `${db.replace(/\/$/, '')}/rest/v1/place_shapes`,
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
  };
}
