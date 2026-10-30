import React from "react";
import { Check, Copy, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { notifyError } from "../../lib/notify";

interface Info { enabled: boolean; code: string; port: number; addresses: string[]; secureAddresses?: string[]; firewall?: string }

const btn = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold disabled:opacity-40 transition-colors";

/** Settings > General > Phone & other devices: whether other devices may open the studio, the code they need, and where to point them. */
export function PhoneAccessSettings() {
  const [info, setInfo] = React.useState<Info | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState("");

  const load = React.useCallback(async () => {
    try { const r = await fetch("/api/phone/info"); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not read the phone settings."); setInfo(d); }
    catch (e: any) { notifyError(e.message); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const change = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { const r = await fetch("/api/phone/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not change it."); await load(); }
    catch (e: any) { notifyError(e.message); } finally { setBusy(false); }
  };
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1400); }).catch(() => {}); };

  if (!info) return <p className="flex items-center gap-2 py-4 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" />Loading...</p>;
  return (
    <div className="divide-y divide-white/5">
      <div className="flex items-center justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-100"><Smartphone size={15} className="text-violet-400" />Allow other devices</p>
          <p className="mt-0.5 text-xs leading-snug text-zinc-500">A phone or another PC on the same Wi-Fi can open the studio with the code below. Switched off, nothing but this PC can reach it.</p>
        </div>
        <button onClick={() => change({ enabled: !info.enabled })} disabled={busy} role="switch" aria-checked={info.enabled} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${info.enabled ? "bg-violet-600" : "bg-white/10"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${info.enabled ? "left-[1.375rem]" : "left-0.5"}`} />
        </button>
      </div>

      {info.enabled && (
        <>
          <div className="py-4">
            <p className="text-sm font-bold tracking-tight text-zinc-100">Access code</p>
            <p className="mt-0.5 text-xs text-zinc-500">The phone asks for it once. This PC never does. A new code signs every phone out.</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-xl bg-black/30 px-4 py-2 font-mono text-2xl font-bold tracking-[0.35em] text-emerald-300">{info.code}</span>
              <button onClick={() => copy(info.code, "code")} className={btn}>{copied === "code" ? <Check size={13} /> : <Copy size={13} />}Copy</button>
              <button onClick={() => change({ newCode: true })} disabled={busy} className={btn}><RefreshCw size={13} />New code</button>
            </div>
          </div>

          <div className="py-4">
            <p className="text-sm font-bold tracking-tight text-zinc-100">Address to open on the phone</p>
            <p className="mt-0.5 text-xs text-zinc-500">In the phone's browser, or in the Cursed Android app (Connect to my PC). Pick the one that starts like your Wi-Fi's addresses, usually 192.168.</p>
            <div className="mt-3 space-y-1.5">
              {info.addresses.length === 0 && <p className="text-xs text-amber-300">No network address found. Connect this PC to Wi-Fi or a network.</p>}
              {info.addresses.map(a => (
                <div key={a} className="flex items-center gap-2">
                  <span className="rounded-lg bg-black/30 px-3 py-1.5 font-mono text-xs text-emerald-300">{a}</span>
                  <button onClick={() => copy(a, a)} className={btn}>{copied === a ? <Check size={13} /> : <Copy size={13} />}Copy</button>
                </div>
              ))}
            </div>
          </div>

          {!!info.secureAddresses?.length && (
            <div className="py-4">
              <p className="text-sm font-bold tracking-tight text-zinc-100">Secure address (for the microphone)</p>
              <p className="mt-0.5 text-xs text-zinc-500">Phone browsers allow the microphone only on a secure page. Open this one instead to talk to the studio. The first time, the phone warns that the connection is not private, because this PC made its own certificate: tap Advanced, then Proceed (Android) or Show details, then visit this website (iPhone).</p>
              <div className="mt-3 space-y-1.5">
                {info.secureAddresses.map(a => (
                  <div key={a} className="flex items-center gap-2">
                    <span className="rounded-lg bg-black/30 px-3 py-1.5 font-mono text-xs text-emerald-300">{a}</span>
                    <button onClick={() => copy(a, a)} className={btn}>{copied === a ? <Check size={13} /> : <Copy size={13} />}Copy</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {info.firewall && (
            <div className="py-4">
              <p className="text-sm font-bold tracking-tight text-zinc-100">If the phone cannot connect</p>
              <p className="mt-0.5 text-xs text-zinc-500">Windows may block the ports. Run this once in a Command Prompt opened as administrator (it allows the port on private networks only):</p>
              <div className="mt-3 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-300">{info.firewall}</code>
                <button onClick={() => copy(info.firewall!, "fw")} className={btn}>{copied === "fw" ? <Check size={13} /> : <Copy size={13} />}Copy</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
