import { Attachment } from "../types";

const MAX_DOC_CHARS = 10000; // keeps a document inside the model's context window
const MAX_IMAGE_PX = 1024;

export interface Picked {
  attachment: Attachment;
  image?: string; // data URL, for image attachments
  note?: string;  // e.g. "truncated"
}

/** Downscale to keep chat history (and the request) small. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't read image "${file.name}"`)); };
    img.src = url;
  });
}

export async function pickFile(file: File): Promise<Picked> {
  if (file.type.startsWith("image/")) {
    return { attachment: { name: file.name, kind: "image" }, image: await readImage(file) };
  }
  const resp = await fetch(`/api/attachments/extract?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Couldn't read "${file.name}"`);
  const truncated = data.text.length > MAX_DOC_CHARS;
  return {
    attachment: { name: file.name, kind: "doc", text: truncated ? data.text.slice(0, MAX_DOC_CHARS) : data.text },
    note: truncated ? `"${file.name}" is long - only the first ${MAX_DOC_CHARS.toLocaleString()} characters are sent.` : undefined,
  };
}
