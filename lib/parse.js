// Turns an uploaded CV (PDF / DOCX / TXT) into plain text. Runs on our server — no AI involved.
export async function fileToText(file) {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) return buf.toString('utf8');
  throw new Error(`Unsupported file type: ${file.name} (use PDF, DOCX or TXT)`);
}
