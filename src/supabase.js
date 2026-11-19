import { createClient } from "@supabase/supabase-js";

export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://lswqweqaogjumqvxttmf.supabase.co";

export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_uK_bYICZ1hhUEujupTuMmw_Hlr1lU1R";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
