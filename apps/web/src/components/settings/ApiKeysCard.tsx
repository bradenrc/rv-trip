"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, Row } from "@/components/settings/SettingsForm";
import { COPIED_CTA } from "@/components/settings/household-view";
import {
  API_KEYS_HELP,
  API_KEYS_TITLE,
  CANCEL_CTA,
  COPY_KEY_CTA,
  DONE_CTA,
  KEEP_CTA,
  MINT_A_KEY_CTA,
  MINT_CTA,
  NO_KEYS,
  REVOKE_CONFIRM,
  REVOKE_CTA,
  REVOKE_KEY_CTA,
  SHOWN_ONCE,
  apiKeysCardFrame,
  canMint,
  mcpAddSnippet,
  mintedLabel,
  type ApiKeyRowProps,
} from "@/components/settings/api-keys-view";

/**
 * Settings → Household → API keys (#162 · Q8 A · docs/design/162 §5) — the
 * second card in the Household group, directly under `HouseholdCard`, with no
 * second `GroupKicker`.
 *
 * Composed from `SettingsForm`'s `Card` / `Row` and `MemberLine`'s 30px
 * avatar-line idiom; nothing here restyles them. The list is the server read
 * (`app/settings/page.tsx`, finished strings only); after a mint or a revoke
 * `router.refresh()` redraws it from that read — the `HouseholdCard` seam.
 * The full key lives in this component's state until Done, and nowhere else.
 *
 * Mint wears the SHIPPED accent CTA, the same fill as the Invite button above
 * it. The wireframe asked for the green CTA per .design-sync/conventions.md,
 * but packages/core's nightfall-tokens sweep (Slate + Sky, sweep 2) forbids
 * any green-cta fill — the tested token rule wins; see dev-notes.
 */
export interface ApiKeysCardProps {
  keys: ApiKeyRowProps[];
  /** `https://roadvalet.com/api/mcp` — the request's own origin. */
  mcpUrl: string;
}

const SECONDARY =
  "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink disabled:cursor-not-allowed disabled:opacity-50";
const DANGER =
  "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-rv-md border border-rv-warning bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-warning disabled:cursor-not-allowed disabled:opacity-50";
const CTA =
  "inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[13px] font-bold text-rv-accent-ink shadow-rv-sm disabled:cursor-not-allowed disabled:opacity-50";

export function ApiKeysCard({ keys, mcpUrl }: ApiKeysCardProps) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<{ name: string; key: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const frame = apiKeysCardFrame({ keyCount: keys.length, naming, minted: minted !== null });

  async function mint() {
    if (busy || !canMint(name)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/household/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { key: string; name: string };
      setMinted({ name: body.name, key: body.key });
      setNaming(false);
      setName("");
    } catch {
      toast.error("That didn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/household/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setConfirmId(null);
      router.refresh();
    } catch {
      toast.error("That didn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function done() {
    // The key leaves client state here, and the list redraws from the server.
    setMinted(null);
    setCopied(false);
    router.refresh();
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the key and copy it by hand.");
    }
  }

  return (
    <div className="mt-[18px]">
      <Card>
        <Row label={API_KEYS_TITLE} help={API_KEYS_HELP} />

        {frame === "minted" && minted && (
          <Row>
            <div className="rounded-rv-md border border-rv-green bg-rv-green-soft px-3 py-2.5">
              <div className="text-[12.5px] font-bold text-rv-green-ink">{mintedLabel(minted.name)}</div>
              <div className="mt-1.5 flex items-center gap-2 rounded-rv-sm border border-rv-border bg-rv-surface px-2 py-1.5 font-mono text-[11.5px] text-rv-ink">
                <span className="min-w-0 flex-1 break-all">{minted.key}</span>
                <button type="button" onClick={() => copyKey(minted.key)} className={SECONDARY}>
                  {copied ? COPIED_CTA : COPY_KEY_CTA}
                </button>
              </div>
              <pre className="m-0 mt-1.5 whitespace-pre-wrap break-all font-mono text-[10.5px] text-rv-ink-muted">
                {mcpAddSnippet(mcpUrl, minted.key)}
              </pre>
              <div className="mt-1.5 font-mono text-[10.5px] text-rv-warning">{SHOWN_ONCE}</div>
              <div className="mt-2">
                <button type="button" onClick={done} className={SECONDARY}>
                  {DONE_CTA}
                </button>
              </div>
            </div>
          </Row>
        )}

        {frame === "empty" && (
          <Row>
            <div className="py-1 text-[12.5px] text-rv-ink-faded">{NO_KEYS}</div>
          </Row>
        )}

        {(frame === "list" || (frame === "naming" && keys.length > 0)) && (
          <Row>
            {keys.map((k) => (
              <div key={k.id}>
                <KeyLine
                  k={k}
                  onRevoke={!k.revoked && confirmId !== k.id ? () => setConfirmId(k.id) : undefined}
                  busy={busy}
                />
                {confirmId === k.id && (
                  <div className="mb-1.5 mt-0.5 flex flex-wrap items-center gap-2 rounded-rv-md border border-rv-warning bg-rv-warning-soft px-2.5 py-2 text-[12px] text-rv-ink-muted">
                    <span>
                      {REVOKE_CONFIRM.before}
                      <b className="text-rv-ink">{k.name}</b>
                      {REVOKE_CONFIRM.after}
                    </span>
                    <button type="button" disabled={busy} onClick={() => revoke(k.id)} className={DANGER}>
                      {REVOKE_KEY_CTA}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setConfirmId(null)} className={SECONDARY}>
                      {KEEP_CTA}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Row>
        )}

        {frame === "naming" && (
          <Row>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void mint();
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                aria-label="Key name"
                className="min-w-[180px] flex-1 rounded-rv-md border border-rv-border-hi bg-rv-surface-alt px-2.5 py-2 text-[13px] text-rv-ink outline-none"
              />
              <button type="submit" disabled={busy || !canMint(name)} className={CTA}>
                {MINT_CTA}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNaming(false);
                  setName("");
                }}
                className={SECONDARY}
              >
                {CANCEL_CTA}
              </button>
            </form>
          </Row>
        )}

        {(frame === "empty" || frame === "list") && (
          <Row>
            <button type="button" onClick={() => setNaming(true)} className={CTA}>
              <Plus className="size-[15px]" strokeWidth={2.5} />
              {MINT_A_KEY_CTA}
            </button>
          </Row>
        )}
      </Card>
    </div>
  );
}

/** One key: the 30px key disc, name over `prefix · minter · used`, and Revoke —
 * absent on a revoked row and on the row whose confirm is open. */
function KeyLine({ k, onRevoke, busy }: { k: ApiKeyRowProps; onRevoke?: () => void; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-[7px]">
      <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-rv-pill border-2 border-rv-border-hi bg-rv-navy-soft text-rv-ink-muted">
        <Key className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[13.5px] font-semibold ${k.revoked ? "text-rv-ink-faded line-through" : "text-rv-ink"}`}
        >
          {k.name}
        </span>
        <span className="block break-all font-mono text-[11.5px] text-rv-ink-faded">{k.meta}</span>
      </span>
      {onRevoke && (
        <button type="button" disabled={busy} onClick={onRevoke} className={SECONDARY}>
          {REVOKE_CTA}
        </button>
      )}
    </div>
  );
}
