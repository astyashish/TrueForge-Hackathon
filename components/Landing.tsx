"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  GitPullRequest,
  Plus,
  Rocket,
  Server,
  Shield,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_CREW, type AgentTypeSummary } from "@/lib/crew";
import { DEMO_CREW, DEMO_IDEA, DEMO_STEPS, DEMO_TITLE } from "@/lib/demo";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Preset worlds for the Operator to drop into. */
const SITE_VIBES = [
  {
    id: "night-shift",
    title: "Night Shift",
    tagline: "A cramped startup server room at 3 a.m., one release from launch",
    icon: Server,
    idea: "a cramped startup server room at 3 a.m. — rain on the windows, racks humming, a release that has to ship before sunrise",
  },
  {
    id: "neon-dc",
    title: "The Neon Data Centre",
    tagline: "A rain-soaked Bangalore data centre glowing magenta and cyan",
    icon: Zap,
    idea: "a rain-soaked Bangalore data centre glowing magenta and cyan, cable runs overhead and glowing gates between the halls",
  },
  {
    id: "orbital",
    title: "Orbital Ops Deck",
    tagline: "A station ring watching a planet-scale deploy roll out",
    icon: Rocket,
    idea: "an orbital operations deck on a station ring, watching a planet-scale deploy roll out across glowing consoles",
  },
];

type McpServerInfo = {
  name: string;
  ok: boolean;
  tools: { name: string; readOnly: boolean; destructive: boolean }[];
};

function NewAgentForm({
  servers,
  onCreated,
  onCancel,
}: {
  servers: McpServerInfo[];
  onCreated: (t: AgentTypeSummary) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [gated, setGated] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleServer = (s: McpServerInfo) => {
    const on = scope.includes(s.name);
    setScope(on ? scope.filter((x) => x !== s.name) : [...scope, s.name]);
    // Default approval policy: every non-read-only tool on the server is gated.
    const writeTools = s.tools.filter((t) => !t.readOnly).map((t) => t.name);
    setGated(on ? gated.filter((g) => !writeTools.includes(g)) : [...new Set([...gated, ...writeTools])]);
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/agent-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, instructions, mcpServers: scope, approvalTools: gated }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create agent");
      onCreated({ ...data.type, ready: scope.length > 0 && scope.every((s) => servers.find((x) => x.name === s)?.ok) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-3">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-main">New agent type</p>
          <Button type="button" variant="neutral" size="icon" className="size-7" onClick={onCancel}>
            <X size={13} />
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name — e.g. Docs Scout" />
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="One-line job description" />
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          placeholder="Skill pack (becomes this agent's SKILL.md): how it works, what it checks, what it must never do…"
          className="resize-none text-sm"
        />
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-inksoft">
            Real system scope (TrueForge MCP servers)
          </p>
          {servers.length === 0 && (
            <p className="text-xs text-inksoft">No MCP servers reachable — is TrueForge running?</p>
          )}
          <div className="flex flex-wrap gap-2">
            {servers.map((s) => (
              <button
                key={s.name}
                type="button"
                disabled={!s.ok}
                onClick={() => toggleServer(s)}
                className={`rounded-base border-2 px-2 py-1 font-mono text-xs ${
                  scope.includes(s.name) ? "border-main bg-main/15 text-foreground" : "border-border text-inksoft"
                } disabled:opacity-40`}
              >
                {s.name} · {s.tools.length} tools
              </button>
            ))}
          </div>
        </div>
        {scope.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-inksoft">
              Approval policy — these tools stop at the Threshold
            </p>
            <div className="flex flex-wrap gap-1.5">
              {servers
                .filter((s) => scope.includes(s.name))
                .flatMap((s) => s.tools)
                .map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setGated(gated.includes(t.name) ? gated.filter((g) => g !== t.name) : [...gated, t.name])}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                      gated.includes(t.name) ? "border-amber-500 bg-amber-400/15 text-foreground" : "border-border text-inksoft"
                    }`}
                  >
                    {gated.includes(t.name) ? "⛔ " : ""}
                    {t.name}
                  </button>
                ))}
            </div>
          </div>
        )}
        {err && <p className="text-xs font-semibold text-red-500">{err}</p>}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={save} disabled={saving || !name.trim() || !role.trim() || !instructions.trim()}>
          {saving ? "Creating…" : "Create agent"}
        </Button>
      </CardFooter>
    </Card>
  );
}

const TYPE_ICON: Record<string, typeof GitPullRequest> = {
  "git-warden": GitPullRequest,
  "deploy-runner": Rocket,
  "server-sentinel": Server,
};

/** Landing page: pick the crew, describe the world, step in. */
export function Landing({ onStart }: { onStart: (idea: string, crew: string[]) => void }) {
  // Pre-filled with the full-feature test world so a fresh visitor can just press Start.
  const [idea, setIdea] = useState(DEMO_IDEA);
  const [showScript, setShowScript] = useState(true);
  const [types, setTypes] = useState<AgentTypeSummary[]>([]);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [trueforgeUp, setTrueforgeUp] = useState<boolean | null>(null);
  const [crew, setCrew] = useState<string[]>(DEFAULT_CREW);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-types");
      const data = await res.json();
      setTypes(data.types ?? []);
      setServers(data.mcpServers ?? []);
      setTrueforgeUp(Boolean(data.trueforge));
    } catch {
      setTrueforgeUp(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = () => {
    const text = idea.trim();
    if (text) onStart(text, crew);
  };

  const typeOf = (id: string) => types.find((t) => t.id === id);

  return (
    <div className="mx-auto grid min-h-dvh max-w-6xl grid-cols-1 items-start gap-10 px-6 py-14 md:grid-cols-[minmax(0,1fr)_1.3fr] md:gap-16 md:py-20">
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
        className="md:sticky md:top-20"
      >
        <div className="mb-6 flex items-end justify-between gap-4 border-b-2 border-border pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-main">TrueForge · Agent Runtime</p>
          <span
            className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${
              trueforgeUp ? "text-emerald-500" : trueforgeUp === false ? "text-red-500" : "text-inksoft"
            }`}
          >
            <span className={`size-1.5 rounded-full ${trueforgeUp ? "bg-emerald-500" : trueforgeUp === false ? "bg-red-500" : "bg-inksoft"}`} />
            {trueforgeUp ? "harness online" : trueforgeUp === false ? "harness offline" : "checking…"}
          </span>
        </div>

        <div className="mb-2 flex items-center gap-3">
          <Zap size={28} className="shrink-0 text-main" strokeWidth={2.5} />
          <h1 className="font-display text-6xl font-extrabold leading-[0.95] tracking-tight text-foreground sm:text-7xl">
            Threshold
          </h1>
        </div>
        <p className="mt-4 max-w-sm text-lg font-semibold text-foreground">
          Where agents work, and you decide where it stops.
        </p>
        <p className="mt-4 max-w-md text-sm font-medium leading-relaxed text-inksoft">
          A real-world software and server-management simulator. Every character is a live TrueForge agent
          bound to a real repo, pipeline or server — reviewing pull requests, shipping releases, watching
          production. They remember what happened last time. And they stop and ask you before anything they
          can&apos;t take back.
        </p>
        <div className="mt-6 flex flex-col gap-2 text-xs font-medium text-inksoft">
          <div className="flex items-center gap-2">
            <TerminalSquare size={12} className="text-main" /> Live ops terminal: the real commands and output
          </div>
          <div className="flex items-center gap-2">
            <Zap size={12} className="text-main" /> Generation console: every model and harness call, as it runs
          </div>
          <div className="flex items-center gap-2">
            <Brain size={12} className="text-main" /> Agent memory carried between runs
          </div>
          <div className="flex items-center gap-2">
            <Shield size={12} className="text-main" /> Threshold Card — the line an agent won&apos;t cross alone
          </div>
        </div>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.08, ease: EASE_OUT }}
      >
        {/* Full feature test */}
        <Card className="mb-8 gap-3 border-main py-4">
          <CardContent className="space-y-3 px-4">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="mt-0.5 shrink-0 text-main" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold text-foreground">{DEMO_TITLE}</p>
                <p className="text-xs leading-snug text-inksoft">
                  A night-shift software office with the full crew. Follow the script — every step exercises a
                  real feature, and each line is also a one-click quick reply inside the game.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setCrew(DEMO_CREW);
                  onStart(DEMO_IDEA, DEMO_CREW);
                }}
              >
                Run the full test <ArrowRight size={15} />
              </Button>
              <Button type="button" variant="neutral" size="sm" onClick={() => setShowScript((v) => !v)}>
                Test script {showScript ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </Button>
            </div>
            {showScript && (
              <ol className="space-y-2 border-t-2 border-border pt-3">
                {DEMO_STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3 text-xs leading-snug">
                    <span className="w-5 shrink-0 text-right font-mono font-bold text-main">{i + 1}.</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-bold text-foreground">{step.who}</span>
                        <Badge variant="neutral" className="text-[9px] uppercase tracking-wider">
                          {step.feature}
                        </Badge>
                      </div>
                      {step.say && (
                        <p className="mt-0.5 font-mono text-[11px] text-main">“{step.say}”</p>
                      )}
                      <p className="mt-0.5 text-inksoft">{step.do}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Crew */}
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-inksoft">Your crew</p>
          <Button type="button" variant="neutral" size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus size={13} /> New agent type
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {crew.map((id, slot) => {
            const t = typeOf(id);
            const Icon = TYPE_ICON[id] ?? TerminalSquare;
            return (
              <Card key={slot} className="gap-2 py-3">
                <CardContent className="space-y-2 px-3">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className="shrink-0 text-main" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-inksoft">Room {slot + 1}</span>
                    {t && (
                      <Badge variant="neutral" className={`ml-auto text-[9px] ${t.ready ? "text-emerald-600" : "text-amber-600"}`}>
                        {t.ready ? "live" : "not connected"}
                      </Badge>
                    )}
                  </div>
                  <select
                    value={id}
                    onChange={(e) => setCrew(crew.map((c, i) => (i === slot ? e.target.value : c)))}
                    className="w-full rounded-base border-2 border-border bg-background px-2 py-1 text-sm font-semibold text-foreground"
                  >
                    {(types.length ? types : [{ id, name: id } as AgentTypeSummary]).map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  <p className="min-h-8 text-xs leading-snug text-inksoft">{t?.role ?? "…"}</p>
                  {t && (
                    <p className="truncate font-mono text-[10px] text-inksoft/80">
                      {t.mcpServers.join(", ") || "no MCP scope"}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        {creating && (
          <NewAgentForm
            servers={servers}
            onCancel={() => setCreating(false)}
            onCreated={(t) => {
              setTypes((prev) => [...prev, t]);
              setCrew((prev) => [...prev.slice(0, 2), t.id]);
              setCreating(false);
            }}
          />
        )}

        {/* World */}
        <Label htmlFor="site-vibe" className="mb-2 mt-8 block text-xs font-bold uppercase tracking-widest text-inksoft">
          Describe the world they work in
        </Label>
        <Card>
          <CardContent>
            <Textarea
              id="site-vibe"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              rows={3}
              placeholder="e.g. A flooded neon data campus at the end of a long release week…"
              className="resize-none"
            />
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] font-medium text-inksoft/70">Any vibe — ⌘↵ to enter</span>
            <Button onClick={submit} disabled={!idea.trim()}>
              Start the shift
              <ArrowRight size={15} />
            </Button>
          </CardFooter>
        </Card>

        <p className="mb-1 mt-8 text-xs font-bold uppercase tracking-widest text-inksoft">Or drop into one of these</p>
        <ul>
          {SITE_VIBES.map((site, i) => {
            const Icon = site.icon;
            return (
              <motion.li
                key={site.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.06, ease: EASE_OUT }}
              >
                <Button
                  variant="noShadow"
                  className="group h-auto w-full justify-start gap-4 rounded-none border-0 border-t-2 border-border bg-transparent px-0 py-4 shadow-none hover:translate-x-0 hover:translate-y-0 hover:bg-transparent hover:shadow-none"
                  onClick={() => onStart(site.idea, crew)}
                >
                  <Icon size={22} strokeWidth={1.75} className="shrink-0 text-main" />
                  <div className="min-w-0 flex-1 text-left">
                    <h2 className="font-display text-lg font-bold text-foreground">{site.title}</h2>
                    <p className="truncate text-sm font-medium text-inksoft">{site.tagline}</p>
                  </div>
                  <ArrowRight
                    size={17}
                    className="shrink-0 text-inksoft/40 transition-all duration-300 group-hover:translate-x-1 group-hover:text-main"
                  />
                </Button>
              </motion.li>
            );
          })}
        </ul>

        <p className="mt-8 border-t-2 border-border pt-5 text-xs font-medium text-inksoft/70">
          Real-time agent execution · built for TrueFoundry × Polaris Hackathon · Bangalore
        </p>
      </motion.div>
    </div>
  );
}
