/** `git status --porcelain=v1` lines as { path, status }: M changed, A added, D deleted, R renamed, ? new (not tracked yet). */
export function parsePorcelain(text: string): { path: string; status: string }[] {
  return text.split(/\r?\n/).filter(l => l.length > 3).map(l => {
    const code = l.slice(0, 2), rest = l.slice(3);
    const path = (rest.includes(" -> ") ? rest.split(" -> ").pop()! : rest).replace(/^"|"$/g, "");
    const status = code === "??" ? "?" : (code.trim()[0] || "M");
    return { path, status };
  });
}
