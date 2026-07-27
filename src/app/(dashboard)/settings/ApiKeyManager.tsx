"use client";

import { useState, useTransition } from "react";
import { generateApiKey, revokeApiKey, type ApiKeyRow } from "./api-key-actions";

const EDGE_URL = "https://awsfqnymosevmhawbukf.supabase.co/functions/v1/softlife-mcp";

export function ApiKeyManager({ keys }: { keys: ApiKeyRow[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    setError(null);
    setNewKey(null);
    startTransition(async () => {
      const res = await generateApiKey(name);
      if (res.ok && res.key) {
        setNewKey(res.key);
        setName("");
      } else {
        setError(res.error ?? "Failed");
      }
    });
  };

  const revoke = (id: string) => {
    startTransition(async () => {
      await revokeApiKey(id);
    });
  };

  const copy = () => {
    if (newKey) {
      navigator.clipboard.writeText(`${EDGE_URL}?key=${newKey}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      {newKey && (
        <div className="rounded-xl border border-sage/40 bg-sage/5 p-4">
          <p className="mb-2 text-xs font-bold text-sage">Key created — copy it now, it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1.5 text-xs text-cocoa">
              {EDGE_URL}?key={newKey}
            </code>
            <button onClick={copy} className="shrink-0 rounded bg-sage px-3 py-1.5 text-xs font-bold text-white hover:bg-sage/80">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Key name (e.g. ChatGPT, Claude Desktop)"
          disabled={pending}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none"
        />
        <button
          onClick={create}
          disabled={pending}
          className="shrink-0 rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "…" : "Generate"}
        </button>
      </div>

      {keys.length > 0 && (
        <div className="space-y-1.5">
          {keys.map((k) => (
            <div key={k.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${k.revoked_at ? "border-line bg-cream/30 opacity-60" : "border-line bg-white"}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-cocoa">{k.name}</span>
                  {k.revoked_at && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[9px] font-bold uppercase text-danger">Revoked</span>}
                </div>
                <div className="text-[10px] text-taupe">
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleString()}`}
                </div>
              </div>
              {!k.revoked_at && (
                <button
                  onClick={() => revoke(k.id)}
                  disabled={pending}
                  className="shrink-0 rounded border border-danger/30 px-2 py-1 text-[10px] font-bold text-danger hover:bg-danger/5 disabled:opacity-40"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
