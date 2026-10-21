import React from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Info, Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The "how does this work" pages for Train LoRA and FineTune LLM: a button for the header and a full-screen guide made of small diagrams. */

type Tone = "violet" | "sky" | "emerald" | "amber" | "rose";
const tones: Record<Tone, string> = {
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};

interface Step { title: string; text: string; tone?: Tone }

function Flow({ steps }: { steps: Step[] }) {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch">
      {steps.map((s, i) => (
        <React.Fragment key={s.title}>
          <div className={cn("flex flex-1 flex-col gap-1.5 rounded-2xl border p-3.5", tones[s.tone || "violet"])}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/30 text-[11px] font-bold">{i + 1}</span>
              <p className="text-sm font-bold text-white">{s.title}</p>
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-300">{s.text}</p>
          </div>
          {i < steps.length - 1 && <div className="flex shrink-0 items-center justify-center text-zinc-600"><ArrowRight size={16} className="rotate-90 md:rotate-0" /></div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-bold text-white">{title}</h3>
        {lead && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

/** Rows of: setting - what it does - a typical value - what goes wrong at either end. */
function Settings({ rows }: { rows: { name: string; does: string; typical: string; low: string; high: string }[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <div className="hidden grid-cols-[9rem_1fr_6rem_1fr_1fr] gap-3 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 md:grid"><span>Setting</span><span>What it does</span><span>Start with</span><span>Too low</span><span>Too high</span></div>
      {rows.map(r => (
        <div key={r.name} className="grid gap-1 border-t border-white/5 px-4 py-2.5 text-[11px] leading-relaxed text-zinc-300 md:grid-cols-[9rem_1fr_6rem_1fr_1fr] md:gap-3">
          <span className="font-bold text-white">{r.name}</span><span>{r.does}</span>
          <span className="font-mono text-violet-300">{r.typical}</span>
          <span className="text-sky-300/90"><b className="md:hidden">Too low: </b>{r.low}</span>
          <span className="text-rose-300/90"><b className="md:hidden">Too high: </b>{r.high}</span>
        </div>
      ))}
    </div>
  );
}

function Tips({ good, bad }: { good: string[]; bad: string[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <p className="text-xs font-bold text-emerald-300">Do</p>
        {good.map(t => <p key={t} className="flex gap-2 text-[11px] leading-relaxed text-zinc-300"><Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />{t}</p>)}
      </div>
      <div className="space-y-1.5 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
        <p className="text-xs font-bold text-rose-300">Avoid</p>
        {bad.map(t => <p key={t} className="flex gap-2 text-[11px] leading-relaxed text-zinc-300"><X size={12} className="mt-0.5 shrink-0 text-rose-400" />{t}</p>)}
      </div>
    </div>
  );
}

const Callout = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-[11px] leading-relaxed text-amber-100/90"><Lightbulb size={15} className="mt-0.5 shrink-0 text-amber-400" /><div>{children}</div></div>
);

/** The idea in one picture: a big frozen model plus a small trainable adapter that is added on top. */
function AdapterDiagram({ big, small, result, noun }: { big: string; small: string; result: string; noun: string }) {
  return (
    <svg viewBox="0 0 720 190" className="w-full" role="img" aria-label={`${big} stays frozen, a small ${small} is trained and added on top`}>
      <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#71717a" /></marker></defs>
      <rect x="10" y="20" width="200" height="150" rx="18" fill="#27272a" stroke="#52525b" />
      <text x="110" y="52" textAnchor="middle" fill="#e4e4e7" fontSize="14" fontWeight="700">{big}</text>
      <text x="110" y="74" textAnchor="middle" fill="#a1a1aa" fontSize="11">billions of numbers</text>
      {[0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5, 6, 7].map(c => <rect key={`${r}${c}`} x={30 + c * 19} y={92 + r * 17} width="15" height="12" rx="3" fill="#3f3f46" />))}
      <text x="110" y="162" textAnchor="middle" fill="#7dd3fc" fontSize="11">FROZEN - never changes</text>
      <text x="245" y="100" textAnchor="middle" fill="#a1a1aa" fontSize="26">+</text>
      <rect x="275" y="55" width="170" height="80" rx="18" fill="#4c1d95" fillOpacity="0.45" stroke="#8b5cf6" />
      <text x="360" y="88" textAnchor="middle" fill="#ede9fe" fontSize="14" fontWeight="700">{small}</text>
      <text x="360" y="108" textAnchor="middle" fill="#c4b5fd" fontSize="11">a few million numbers</text>
      <text x="360" y="125" textAnchor="middle" fill="#fcd34d" fontSize="11">TRAINED - learns it</text>
      <line x1="450" y1="95" x2="500" y2="95" stroke="#71717a" strokeWidth="2" markerEnd="url(#ar)" />
      <rect x="510" y="35" width="200" height="120" rx="18" fill="#064e3b" fillOpacity="0.4" stroke="#10b981" />
      <text x="610" y="82" textAnchor="middle" fill="#d1fae5" fontSize="14" fontWeight="700">{result}</text>
      <text x="610" y="104" textAnchor="middle" fill="#6ee7b7" fontSize="11">now knows your {noun}</text>
      <text x="610" y="124" textAnchor="middle" fill="#a1a1aa" fontSize="10">the add-on is a small file</text>
    </svg>
  );
}

/** What each point of the pipeline looks like on disk. */
function Files({ items }: { items: { name: string; note: string }[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {items.map(f => <div key={f.name} className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="break-all font-mono text-[11px] text-violet-300">{f.name}</p><p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{f.note}</p></div>)}
    </div>
  );
}

/** A picture-and-caption pair, the unit a LoRA dataset is made of. */
function PairDiagram() {
  const cards = [
    { cap: "zzchar, a woman in a red coat, smiling, standing in a street, daytime", ok: true, label: "Good: names the trigger, describes what changes" },
    { cap: "zzchar, a woman with long black hair and green eyes and a freckled face", ok: false, label: "Weak: describes what should be learned (her face)" },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map(c => (
        <div key={c.cap} className={cn("flex gap-3 rounded-2xl border p-3", c.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
          <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 rounded-xl bg-zinc-800"><circle cx="32" cy="24" r="10" fill="#a78bfa" /><path d="M12 58c2-14 12-20 20-20s18 6 20 20z" fill="#7c3aed" /></svg>
          <div className="min-w-0"><p className="break-words font-mono text-[11px] text-zinc-200">{c.cap}</p><p className={cn("mt-1.5 text-[10px] font-bold", c.ok ? "text-emerald-300" : "text-rose-300")}>{c.label}</p></div>
        </div>
      ))}
    </div>
  );
}

/** How an instruction/answer example turns into the text the model reads. */
function PromptDiagram() {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_auto_1.2fr] md:items-center">
      <div className="space-y-1.5 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3.5 text-[11px]">
        <p className="font-bold text-sky-200">One example</p>
        <p className="text-zinc-300"><b className="text-sky-300">Instruction:</b> What is the capital of France?</p>
        <p className="text-zinc-300"><b className="text-sky-300">Input:</b> (optional extra text)</p>
        <p className="text-zinc-300"><b className="text-sky-300">Output:</b> Paris.</p>
      </div>
      <ArrowRight size={18} className="mx-auto rotate-90 text-zinc-600 md:rotate-0" />
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-3.5 font-mono text-[10.5px] leading-relaxed text-zinc-300">{`### Instruction:
What is the capital of France?

### Input:

### Response:
Paris.`}<span className="text-violet-400">{"  <- the model is graded on this part"}</span></pre>
    </div>
  );
}

export function GuideButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} title="How it works - a picture guide" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"><Info size={14} className="text-violet-400" />Guide</button>;
}

function GuideFrame({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/95" role="dialog" aria-label={title}>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/5 px-7 py-4">
          <div><h2 className="text-lg font-bold text-white">{title}</h2><p className="text-[11px] text-zinc-500">{subtitle}</p></div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-7 py-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function LoraGuide({ onClose }: { onClose: () => void }) {
  return (
    <GuideFrame title="How to train a character LoRA" subtitle="From a handful of pictures to a file that makes Flux draw the same character" onClose={onClose}>
      <Section title="What is a LoRA?" lead="Flux already knows how to draw almost anything, but it has never seen your character. Instead of re-teaching the whole model (huge, slow, needs a data centre), you train a tiny add-on that nudges it. Training changes only the add-on, so it fits on a home GPU and the result is a small file you can switch on or off.">
        <AdapterDiagram big="Flux model" small="LoRA add-on" result="Flux + your LoRA" noun="character" />
      </Section>

      <Section title="The whole job in five steps" lead="The app has two tabs. Steps 1-2 happen on the Dataset tab, steps 3-5 on the Train tab. Click Next: Train at the bottom to switch.">
        <Flow steps={[
          { title: "Collect pictures", text: "15-30 images of ONE character. No picture yet? Make a sketch with ComfyUI and use it as the first one.", tone: "sky" },
          { title: "Caption each", text: "A short text per picture. The captioner (Florence-2 or an Ollama vision model) writes them, you fix them.", tone: "sky" },
          { title: "Pick a trigger word", text: "A made-up word like zzchar, typed on the Train tab. It becomes the name you use in prompts to summon the character.", tone: "violet" },
          { title: "Train", text: "Open the Train tab, type the trigger word, pick the dataset and press the purple Start LoRA training button at the bottom. The log shows progress and loss.", tone: "amber" },
          { title: "Use it", text: "Copy to ComfyUI, load it with a LoRA node, put the trigger word in your prompt.", tone: "emerald" },
        ]} />
      </Section>

      <Section title="Good pictures, good captions" lead="The model learns whatever is the same in every picture, and ignores what changes. So make the character the constant and everything else vary.">
        <PairDiagram />
        <Tips
          good={["Different angles, outfits, backgrounds and lighting", "Sharp, well lit, face clearly visible in most", "Caption the things that change (clothes, place, pose); the trigger word carries the character", "Delete any picture with a second person or heavy text/watermark"]}
          bad={["Fifty near-identical frames from the same shot", "Blurry, tiny or heavily filtered images", "Captions that spell out the face and hair you want it to learn", "Mixing several characters in one dataset"]}
        />
      </Section>

      <Section title="The numbers on the Train tab" lead="The defaults suit an 8 GB card. Change one thing at a time, and only if a result is bad.">
        <Settings rows={[
          { name: "GPU memory", does: "Picks how aggressively the model is squeezed (fp8 weights, blocks swapped to system RAM).", typical: "your card", low: "Runs out of memory if you pick more than the card has.", high: "Slower than needed, but works." },
          { name: "Resolution", does: "Size pictures are trained at.", typical: "768", low: "Fast and light, softer detail.", high: "Sharper, but needs much more memory and time." },
          { name: "Repeats", does: "How many times each picture is shown per epoch.", typical: "10", low: "Character is only half-learned.", high: "Memorises the pictures (overfits)." },
          { name: "Epochs", does: "Full passes over the dataset. Total steps = pictures x repeats x epochs.", typical: "16", low: "Weak likeness.", high: "Rigid images that ignore your prompt." },
          { name: "Network dim (rank)", does: "Size of the add-on: how much it can learn.", typical: "16", low: "Cannot capture a complex character.", high: "Bigger file, easier to overfit." },
          { name: "Learning rate", does: "How big each correction is.", typical: "8e-4", low: "Barely changes; needs more epochs.", high: "Unstable, burnt-looking images." },
        ]} />
        <Callout>Watch the log: the <b>loss</b> number should wander down and then flatten. If your sample images start looking identical whatever you type, stop earlier or use a lower epoch count. The LoRA is saved at the end of every epoch, so you can test earlier versions.</Callout>
      </Section>

      <Section title="What you end up with">
        <Files items={[
          { name: "my_character.safetensors", note: "The finished LoRA. Use Copy to ComfyUI in the Train tab and it appears in your LoRA list." },
          { name: "my_character-000008.safetensors", note: "Earlier epochs, saved along the way. Often the best one is not the last." },
          { name: "dataset folder (.jpg + .txt)", note: "Every picture with a text file of the same name holding its caption. Reusable for another run." },
        ]} />
        <Flow steps={[
          { title: "In ComfyUI", text: "Add a Load LoRA node after the Flux model. Strength 0.8-1.0 to start.", tone: "emerald" },
          { title: "In your prompt", text: "Write the trigger word: \"zzchar sitting in a cafe, rainy window\".", tone: "emerald" },
          { title: "Too strong or weak?", text: "Lower the strength if it looks overcooked, raise it if the likeness is faint.", tone: "amber" },
        ]} />
      </Section>
    </GuideFrame>
  );
}

export function FineTuneGuide({ onClose }: { onClose: () => void }) {
  return (
    <GuideFrame title="How to fine-tune a language model" subtitle="Teach a small model your own material, then chat with it in Ollama" onClose={onClose}>
      <Section title="What is fine-tuning?" lead="A base model already speaks well but knows nothing about your notes, your style or your task. Fine-tuning shows it many example questions with the answers you want. Like image LoRAs, only a small add-on is trained (QLoRA with Unsloth), so a 4-8 GB card is enough for small models.">
        <AdapterDiagram big="Base model" small="LoRA adapter" result="Your model" noun="material" />
      </Section>

      <Section title="The whole job in five steps" lead="Steps 1-2 are the Dataset tab, steps 3-5 the Fine-tune tab. Click Next: Fine-tune at the bottom to switch.">
        <Flow steps={[
          { title: "Gather material", text: "Drop PDFs, Word files, web pages or pasted text. Or just type examples by hand.", tone: "sky" },
          { title: "Make question/answer pairs", text: "A helper model reads each chunk and writes Q&A pairs. You review and edit them.", tone: "sky" },
          { title: "Choose a base model", text: "A small 4-bit model (1B-8B). Bigger knows more but needs more memory.", tone: "violet" },
          { title: "Train", text: "Open the Fine-tune tab, pick the base model and dataset, then press the purple Start fine-tune button at the bottom. The log shows loss going down.", tone: "amber" },
          { title: "Add to Ollama", text: "Export as GGUF and register it. It now shows up in Chat like any other model.", tone: "emerald" },
        ]} />
      </Section>

      <Section title="What a training example looks like" lead="Every example is an instruction, an optional input and the answer you want. The app wraps it in a fixed template; the model is only graded on the response part, so it learns to answer that way.">
        <PromptDiagram />
        <Callout>The preview under the hand-written examples shows the exact text the model will see. The same template must be used when you chat with the result, which the Ollama export takes care of.</Callout>
      </Section>

      <Section title="Quality beats quantity" lead="A few hundred clean, varied pairs beat thousands of sloppy ones. The model copies whatever it is shown, mistakes included.">
        <Tips
          good={["100-1000 pairs covering different questions on your material", "Answers written the way you want the model to answer (length, tone, format)", "Read a sample of the generated pairs and delete wrong or filler ones", "Keep a few questions aside to test the result afterwards"]}
          bad={["Pairs auto-generated by a tiny model and never read", "The same question repeated with tiny wording changes", "Contradicting answers about the same fact", "Expecting it to memorise a whole book word for word"]}
        />
      </Section>

      <Section title="The numbers on the Fine-tune tab" lead="The defaults are a safe starting point. If the result is bad, fix the data before touching these.">
        <Settings rows={[
          { name: "Base model", does: "The model being taught. Pick a 4-bit one to save memory.", typical: "1B-8B", low: "Small models learn style well but hold less knowledge.", high: "Needs more memory; may not fit your card." },
          { name: "LoRA rank", does: "Size of the adapter: how much it can absorb.", typical: "16", low: "Cannot absorb much new material.", high: "Bigger, slower, can overfit small datasets." },
          { name: "LoRA alpha", does: "Scales the adapter's push. Usually equal to the rank.", typical: "= rank", low: "Gentle changes.", high: "Overpowers the base model." },
          { name: "Epochs", does: "Full passes over your pairs.", typical: "1-3", low: "Model hardly changes.", high: "Memorises the pairs and gets worse at everything else." },
          { name: "Learning rate", does: "Size of each correction.", typical: "2e-4", low: "Slow, little effect.", high: "Loss jumps around, garbled output." },
          { name: "Batch size", does: "Pairs processed together. Raise it only if memory allows.", typical: "1-2", low: "Slower but safest on memory.", high: "Out-of-memory error." },
          { name: "Max length", does: "Longest example in tokens; longer ones are cut.", typical: "1024-2048", low: "Long answers are truncated.", high: "Uses a lot of memory." },
        ]} />
        <Callout>Out of memory? Lower the batch size, then the max length, then pick a smaller base model. Other programs using the GPU (ComfyUI, a loaded Ollama model) are unloaded for you when training starts.</Callout>
      </Section>

      <Section title="What you end up with">
        <Files items={[
          { name: "adapter folder", note: "The trained LoRA adapter. Small. Needs the same base model to work." },
          { name: "model.gguf", note: "Base model and adapter merged into one file Ollama can run. Created when the GGUF option is ticked." },
          { name: "Ollama model name", note: "Use Add to Ollama. Then pick it in Chat, and test with the questions you kept aside." },
        ]} />
      </Section>
    </GuideFrame>
  );
}
