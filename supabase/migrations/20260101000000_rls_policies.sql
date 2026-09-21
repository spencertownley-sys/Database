-- Supabase-only migration: auth wiring + RLS policies.
-- Apply on Supabase AFTER the Drizzle migrations in src/db/migrations.
-- (Not used for local development databases, which have no auth schema.)

-- profiles.id mirrors auth.users
ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_auth_users_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create a profile row automatically on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable RLS everywhere. The app's own server code talks to Postgres over a
-- direct (non-RLS-restricted) connection via Drizzle, so these policies are
-- the backstop for any client that connects with the Supabase anon/auth key
-- directly (e.g. the browser Supabase client used for auth only today).
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE band_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile.
CREATE POLICY "read own profile" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "update own profile" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- A leader manages only the bands they created.
CREATE POLICY "leader manages own bands" ON bands FOR ALL TO authenticated
  USING (leader_id = auth.uid())
  WITH CHECK (leader_id = auth.uid());

-- A leader manages members/availability of their own bands. Band members
-- themselves reach this data only through the app's server-side actions
-- (which authenticate them by member_token, not by a Supabase session), so
-- no anon-role policy is needed here.
CREATE POLICY "leader manages own band members" ON band_members FOR ALL TO authenticated
  USING (band_id IN (SELECT id FROM bands WHERE leader_id = auth.uid()))
  WITH CHECK (band_id IN (SELECT id FROM bands WHERE leader_id = auth.uid()));

CREATE POLICY "leader reads own weekly availability" ON availability_weekly FOR SELECT TO authenticated
  USING (member_id IN (
    SELECT bm.id FROM band_members bm
    JOIN bands b ON b.id = bm.band_id
    WHERE b.leader_id = auth.uid()
  ));

CREATE POLICY "leader reads own exceptions" ON availability_exceptions FOR SELECT TO authenticated
  USING (member_id IN (
    SELECT bm.id FROM band_members bm
    JOIN bands b ON b.id = bm.band_id
    WHERE b.leader_id = auth.uid()
  ));
