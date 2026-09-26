"use client";

/**
 * Auth-free home page — create a new ops site or browse the gallery.
 * No login required.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { motion } from "framer-motion";
import { ArrowRight, Trash2 } from "lucide-react";
import { World } from "@/components/World";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BrandLogo } from "@/components/BrandLogo";
import { HomePageSkeleton } from "@/components/HomePageSkeleton";
import { MAX_CREATE_IDEA_LENGTH } from "@/lib/constants";
import type { GameListItem } from "@/lib/types/client";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data as T;
}

export function Home() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [games, setGames] = useState<GameListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingIdea, setCreatingIdea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gameList = await request<GameListItem[]>("/api/games");
      setGames(gameList);
    } catch {
      // Gallery load failing is non-fatal — just show empty
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCreate = () => {
    const text = idea.trim();
    if (!text) return;
    posthog.capture("world_create_started", { idea_length: text.length });
    setCreatingIdea(text);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/games/${deleteTarget}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed.");
      }
      posthog.capture("own_world_delete_confirmed", { game_id: deleteTarget });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setDeleteTarget(null);
    }
  };

  if (creatingIdea) {
    return <World mode="create" initialIdea={creatingIdea} />;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-6 py-14 md:py-24">
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="mb-12 border-b-2 border-border pb-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-widest text-main">
            TrueForge · Agent Runtime
          </p>
        </div>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-5">
          <BrandLogo size={60} className="h-18 w-18 shrink-0" />
          <div>
            <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-7xl">
              Threshold
            </h1>
            <p className="mt-2 text-base font-semibold text-inksoft">
              Where agents work, and you decide where it stops.
            </p>
          </div>
        </div>
      </motion.header>

      {error && (
        <Alert variant="destructive" className="mb-8">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Create a new ops site */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06, ease: EASE_OUT }}
        className="mb-14"
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-inksoft">
          Start a new ops run
        </p>
        <Card>
          <CardContent>
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                  startCreate();
              }}
              maxLength={MAX_CREATE_IDEA_LENGTH}
              rows={3}
              placeholder="e.g. A flooded neon data campus where idle machines drain money into the dark…"
              className="resize-none"
            />
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] font-medium text-inksoft/70">
              ⌘↵ to generate
            </span>
            <Button onClick={startCreate} disabled={!idea.trim()}>
              Generate ops site
              <ArrowRight size={15} />
            </Button>
          </CardFooter>
        </Card>
      </motion.section>

      {/* Gallery */}
      {loading ? (
        <HomePageSkeleton />
      ) : (
        <>
          {games.length > 0 && (
            <section className="mb-14">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-inksoft">
                Previous runs
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
                {games.map((game, i) => (
                  <motion.div
                    key={game.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.4,
                      delay: 0.12 + i * 0.04,
                      ease: EASE_OUT,
                    }}
                    className="group relative"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        posthog.capture("community_world_opened", { game_id: game.id });
                        router.push(`/play/${game.id}`);
                      }}
                      className="relative aspect-4/3 w-full overflow-hidden rounded-base border-2 border-border text-left shadow-shadow transition hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
                    >
                      {game.thumbnailUrl ? (
                        <img
                          src={game.thumbnailUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-foreground/10" />
                      )}
                      <div className="absolute inset-0 bg-linear-to-t from-foreground/80 via-foreground/20 to-transparent" />
                      <p className="absolute inset-x-0 bottom-0 px-3 pb-3 font-display text-sm font-bold text-white">
                        {game.title}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="neutral"
                      size="icon"
                      className="absolute right-1 top-1 size-6 opacity-0 transition group-hover:opacity-100 text-inksoft hover:text-health"
                      onClick={() => setDeleteTarget(game.id)}
                      title="Delete run"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </motion.div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this run?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
