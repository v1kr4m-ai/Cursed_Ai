import React from "react";
import { Check, Copy, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { notifyError } from "../../lib/notify";

interface Info { enabled: boolean; code: string; port: number; addresses: string[]; secureAddresses?: string[]; firewall?: string }

/** Tailscale gives each device an address in 100.64.0.0/10; such an address works away from home too. */
const isTailscale = (url: string) => { const m = url.match(/\/\/100\.(\d+)\./); return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127; };
const Tag = ({ url }: { url: string }) => isTailscale(url) ? <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-300">Tailscale - works away from home</span> : null;

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

  const ports = info?.firewall?.match(/localport=([\d,]+)/)?.[1] || String(info?.port || 3000);
  const tailscaleRule = `netsh advfirewall firewall add rule name="Cursed_Ai via Tailscale" dir=in action=allow protocol=TCP localport=${ports} remoteip=100.64.0.0/10 profile=any`;

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
                    <Tag url={a} />
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
                    <Tag url={a} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="group py-4">
            <summary className="cursor-pointer list-none text-sm font-bold tracking-tight text-zinc-100">Use it away from home <span className="text-xs font-normal text-zinc-500">(mobile data, another Wi-Fi) - how to</span></summary>
            <div className="mt-2 space-y-2 text-xs leading-relaxed text-zinc-400">
              <p>The addresses above only work on your home Wi-Fi. The simplest safe way to reach the PC from anywhere is <b className="text-zinc-200">Tailscale</b>, a free private network between your own devices: nothing is opened on your router and nobody else can reach the PC.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>On this PC, install Tailscale from <span className="font-mono text-zinc-300">tailscale.com/download</span> and sign in.</li>
                <li>On the phone, install the Tailscale app and sign in with the same account. Leave it switched on.</li>
                <li>Come back to this card: a <span className="text-sky-300">Tailscale</span> address (it starts with 100.) appears in the lists above. Open the secure one on the phone, or type it into the Cursed Android app. The access code still applies.</li>
              </ol>
              {info.firewall && <>
                <p>If the phone cannot reach the Tailscale address, Windows may treat that network as public. This command (run once, as administrator) allows the ports only from Tailscale addresses:</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px] text-zinc-300">{tailscaleRule}</code>
                  <button onClick={() => copy(tailscaleRule, "ts")} className={btn}>{copied === "ts" ? <Check size={13} /> : <Copy size={13} />}Copy</button>
                </div>
              </>}
              <p>The PC has to be on and the app running; while away, video and pictures travel over the phone's data.</p>
            </div>
          </details>

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
