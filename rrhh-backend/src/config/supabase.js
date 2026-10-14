const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Esta aplicación usa Supabase exclusivamente desde el backend.
// La service_role key NUNCA debe exponerse en el frontend ni versionarse en Git.
if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(
    "❌ FALTA CONFIGURACIÓN: Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el .env del backend.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabase;
