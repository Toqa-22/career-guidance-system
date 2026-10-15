// The hub's login checks against the WORKSHOPS project's admin login
// (verify_admin_login) — this is the "main" login both projects now sit
// behind. The Training project keeps its own separate Supabase project for
// its own data; only authentication is centralized here.
export const SUPABASE_URL = "https://wldrxargdqrthizeomio.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsZHJ4YXJnZHFydGhpemVvbWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMDQ3MDQsImV4cCI6MjEwMzY4MDcwNH0.Uap9b7lRLSxx1SgFCI9IkMGH_jV1yB5RW3ETW23Wgrw";
