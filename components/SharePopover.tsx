"use client";

/**
 * Share button + popover (host only). The link is <public-url>/play/<gameId>,
 * where public-url comes from a running tunnel (share.bat / npm run share)
 * or THRESHOLD_PUBLIC_URL. Anyone opening it gets Watch mode: the live world,
 * read-only, mirroring this game's real TrueForge sessions.
 */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Eye, Share2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SharePopover({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const link = publicUrl ? `${publicUrl}/play/${gameId}` : null;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/share/status", { cache: "no-store" });
      const d = await r.json();
      setPublicUrl(d.publicUrl ?? null);
    } catch {
      setPublicUrl(null);
    } finally {
      setChecked(true);
    }
  }, []);

  // Poll while open, so starting the tunnel shows the link without a reload.
  useEffect(() => {
    if (!open) return;
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [open, refresh]);

  useEffect(() => {
    if (!link) return setQr(null);
    QRCode.toDataURL(link, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(null));
  }, [link]);

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} title="Share this world">
        <Share2 size={14} /> Share
      </Button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-base border-2 border-border bg-background p-4 text-left shadow-shadow">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-base font-bold text-foreground">Share this world</p>
            <button type="button" onClick={() => setOpen(false)} className="text-inksoft hover:text-foreground">
              <X size={15} />
            </button>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 rounded-base border-2 border-main bg-main/10 px-2 py-1.5 font-semibold text-foreground">
              <Eye size={13} /> Watch (read-only)
            </div>
            <div
              className="flex items-center gap-1.5 rounded-base border-2 border-border px-2 py-1.5 text-inksoft opacity-60"
              title="Not built yet"
            >
              <Users size={13} /> Play together — soon
            </div>
          </div>

          {link ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-base border-2 border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
                />
                <Button size="icon" className="size-8 shrink-0" onClick={copy} title="Copy link">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </Button>
              </div>
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR code for the share link" className="mx-auto mt-3 size-40 rounded bg-white p-1" />
              )}
              <p className="mt-3 text-[11px] leading-snug text-inksoft">
                Anyone with the link watches the live world and this game&apos;s real TrueForge sessions, read-only.
                It works while this laptop is awake and the tunnel is running.
              </p>
            </>
          ) : (
            <div className="rounded-base border-2 border-dashed border-border p-3 text-xs leading-snug text-inksoft">
              {checked ? (
                <>
                  <p className="font-semibold text-foreground">No public link yet.</p>
                  <p className="mt-1">
                    This app only runs on localhost, so a localhost link won&apos;t open for anyone else. Double-click{" "}
                    <span className="font-mono">share.bat</span> (or run <span className="font-mono">npm run share</span>) to
                    start a tunnel — the link appears here automatically.
                  </p>
                </>
              ) : (
                "Checking…"
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
