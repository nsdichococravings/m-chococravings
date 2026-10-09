// WealthPilot settings. Fill these in from Supabase > Project Settings > API.
// Leave SUPABASE_URL empty to run the app in demo mode with sample numbers.
window.WEALTHPILOT_CONFIG = {
  SUPABASE_URL: "",       // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",  // the "anon public" key (safe to put in a web page)
  LOGIN_VIA_FUNCTION: true, // sign-in goes through the auth-login function (lockout after 5 wrong passwords)
};
