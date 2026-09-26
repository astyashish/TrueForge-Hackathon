/** Shown to viewers (shared links) who open anything other than a shared world. */
export default function SharedOnly() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#020308] px-6 text-center text-white">
      <div className="max-w-md">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/70">Threshold</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">This is a shared view</h1>
        <p className="mt-3 text-sm text-white/60">
          Shared links open one specific game, read-only. Ask the host for the game&apos;s share link
          (it looks like <span className="font-mono">…/play/&lt;game-id&gt;</span>).
        </p>
      </div>
    </main>
  );
}
