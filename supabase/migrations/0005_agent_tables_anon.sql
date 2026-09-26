-- Auth-free hackathon mode: let the anon role use the agent tables too.
-- (0003 only granted access to `authenticated`, so bindings/approval logs
-- silently failed once login was removed.)

create policy "agent_bindings_select_anon"
on public.agent_bindings for select to anon using (true);

create policy "agent_bindings_insert_anon"
on public.agent_bindings for insert to anon with check (true);

create policy "agent_bindings_update_anon"
on public.agent_bindings for update to anon using (true);

create policy "approval_events_select_anon"
on public.approval_events for select to anon using (true);

create policy "approval_events_insert_anon"
on public.approval_events for insert to anon with check (true);

-- Scene art uploads: the auth-free guest (lib/supabase/auth.ts) writes under
-- its own fixed folder in the game-assets bucket.
create policy "game_assets_guest_insert"
on storage.objects for insert to anon
with check (
  bucket_id = 'game-assets'
  and (storage.foldername (name))[1] = '00000000-0000-0000-0000-000000000001'
);

create policy "game_assets_guest_update"
on storage.objects for update to anon
using (
  bucket_id = 'game-assets'
  and (storage.foldername (name))[1] = '00000000-0000-0000-0000-000000000001'
);

-- Upsert uploads need to see the existing object.
create policy "game_assets_guest_select"
on storage.objects for select to anon
using (
  bucket_id = 'game-assets'
  and (storage.foldername (name))[1] = '00000000-0000-0000-0000-000000000001'
);
