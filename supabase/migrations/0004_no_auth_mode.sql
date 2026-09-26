-- Make games.owner nullable for auth-free hackathon mode
ALTER TABLE public.games
  ALTER COLUMN owner DROP NOT NULL;

-- Also allow unauthenticated inserts for the hackathon demo
-- (RLS still enforces reads in the original policies, but we add anon insert)
CREATE POLICY "games_insert_anon"
ON public.games
FOR INSERT
TO anon
WITH CHECK (true);

-- Allow anon to select games too (for the gallery)
CREATE POLICY "games_select_anon"
ON public.games
FOR SELECT
TO anon
USING (true);

-- Allow anon inserts for game_scenes
CREATE POLICY "game_scenes_insert_anon"
ON public.game_scenes
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "game_scenes_select_anon"
ON public.game_scenes
FOR SELECT
TO anon
USING (true);

CREATE POLICY "game_scenes_update_anon"
ON public.game_scenes
FOR UPDATE
TO anon
USING (true);
