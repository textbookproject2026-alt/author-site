// A document goes up in 2.5 MB parts, one request each, exactly as the portal's
// request form sends a manuscript: the function's host refuses request bodies over
// 4.5 MB, and base64 adds a third. Each part comes back with a receipt good for this
// author only; the import is then started with the receipts, in order.

import { importPart } from "./api.js";

export const PART = 2.5 * 1024 * 1024;
export const MAX_BYTES = 20 * 1024 * 1024;

function readBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("The document couldn't be read from this computer."));
    r.readAsDataURL(blob);
  });
}

/** The kinds of document that can be brought in (suggest-edit-function WORD_TYPES). */
export const ACCEPT = ".docx,.doc,.odt,.rtf";

/** Why this file can't be brought in, or null. */
export function fileProblem(file) {
  if (!file) return "Please choose a document.";
  if (!/\.(docx|doc|odt|rtf)$/i.test(file.name)) {
    return "That kind of file can't be brought in. It needs to be a Word document (.docx or .doc), an OpenDocument text (.odt, from LibreOffice) or a Rich Text file (.rtf). Pages can export to .docx: File, then Export To, then Word.";
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return "That document is over 20 MB. Save a copy with smaller pictures, or split it in two.";
  return null;
}

/** Uploads every part in turn, reporting progress (0..1). Resolves to the receipts. */
export async function uploadParts(file, onProgress = () => {}) {
  const receipts = [];
  for (let at = 0; at < file.size; at += PART) {
    const slice = file.slice(at, at + PART);
    const { receipt } = await importPart(await readBase64(slice));
    receipts.push(receipt);
    onProgress(Math.min(1, (at + slice.size) / file.size));
  }
  return receipts;
}
