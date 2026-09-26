import type { User } from "@supabase/supabase-js";

/**
 * Auth-free mode: returns a synthetic guest user so all API routes
 * work without a real Supabase session.
 *
 * In a production deployment you'd swap this back to a real auth check.
 */
export async function requireUser(): Promise<User> {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "guest@threshold.local",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
}
