import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lists the files in a PUBLIC Google Drive folder ("anyone with the link can view").
export async function GET(req) {
  try {
    const q = new URL(req.url).searchParams.get('folder') || '';
    const id = (q.match(/folders\/([\w-]+)/) || q.match(/id=([\w-]+)/) || [null, q.trim()])[1];
    if (!id) throw new Error('Paste a Google Drive folder link');
    const html = await (await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`)).text();
    const files = [];
    const re = /id="entry-([\w-]+)"[\s\S]*?class="flip-entry-title">([^<]+)</g;
    let m;
    while ((m = re.exec(html))) files.push({ id: m[1], name: m[2].replace(/&amp;/g, '&').trim() });
    const cvs = files.filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!cvs.length) throw new Error('No PDF/DOCX files found — is the folder shared as "Anyone with the link"?');
    return NextResponse.json(cvs);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
