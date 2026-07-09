-- Supabase-only migration: auth wiring + RLS policies.
-- Apply on Supabase AFTER the Drizzle migrations in src/db/migrations.
-- (Not used for local development databases, which have no auth schema.)

-- profiles.id mirrors auth.users
ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_auth_users_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create a profile row automatically on signup (default role: viewer)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper: current user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Enable RLS everywhere
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ships ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voyages ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_voyages ENABLE ROW LEVEL SECURITY;
ALTER TABLE disclaimers ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_disclaimers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read everything
CREATE POLICY "read all authenticated" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON ships FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON voyages FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON promotions FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON promo_voyages FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON disclaimers FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON promo_disclaimers FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON audience_segments FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON promo_audiences FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON promo_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "read all authenticated" ON activity_log FOR SELECT TO authenticated USING (true);

-- Users can update their own profile (but not their role)
CREATE POLICY "update own profile" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- Admins manage profiles
CREATE POLICY "admins manage profiles" ON profiles FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin');

-- Writers: admin, manager, coordinator can create/update promo-related data
CREATE POLICY "writers insert" ON promotions FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers update" ON promotions FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "admins delete" ON promotions FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

CREATE POLICY "writers manage" ON promo_voyages FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON promo_disclaimers FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON promo_audiences FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON disclaimers FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON audience_segments FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON ships FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON voyages FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager', 'coordinator'));
CREATE POLICY "writers manage" ON regions FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'manager'));

-- Performance data: managed by admins/managers/analysts pipelines
CREATE POLICY "analysts insert" ON promo_performance FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('admin', 'manager', 'analyst'));

-- Activity log: any authenticated writer can append; nobody updates/deletes
CREATE POLICY "writers append" ON activity_log FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('admin', 'manager', 'coordinator', 'analyst'));
