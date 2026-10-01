'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';

const ROLES = { PM: 'Product Manager', SPM: 'Senior Product Manager' };
const SHORTLIST = 5;
const first = (n) => (n || '').split(' ')[0];
const fill = (s, n) => (s || '').replaceAll('[NAME]', first(n));

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out;
}

export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('PM');
  const [open, setOpen] = useState(null);
  const [role, setRole] = useState('PM');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [loadErr, setLoadErr] = useState('');

  const say = (m) => setLog((l) => [...l, m]);
  const load = useCallback(async () => {
    try { setRows(await api('/api/candidates')); setLoadErr(''); } catch (e) { setLoadErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function draftLoop() {
    say('Ranking + writing briefs and emails…');
    for (let i = 0; i < 40; i++) {
      const r = await api('/api/recompute', {});
      if (r.processed) say(`  drafted ${r.processed}, ${r.remaining} left`);
      await load();
      if (!r.remaining) break;
    }
    say('Done.');
  }

  async function upload() {
    if (!files.length) return;
    setBusy(true); setLog([]);
    let ok = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f); fd.append('role', role);
      say(`↑ ${f.name} (${role})`);
      try {
        const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error); return j; });
        say(`  ✓ ${r.name} — PM ${r.PM} · SPM ${r.SPM}`); ok++;
      } catch (e) { say(`  ✗ ${e.message}`); }
    }
    await load();
    if (ok) { try { await draftLoop(); } catch (e) { say(`✗ ${e.message}`); } }
    setFiles([]); setBusy(false);
    const input = document.getElementById('cvs'); if (input) input.value = '';
  }

  const list = useMemo(() => rows
    .filter((c) => c.applied_role === tab)
    .sort((a, b) => (b.scores?.[tab]?.total ?? -1) - (a.scores?.[tab]?.total ?? -1)), [rows, tab]);

  const counts = useMemo(() => {
    const r = rows.filter((c) => c.applied_role === tab);
    return { total: r.length, invite: r.filter((c) => c.decision === 'invite').length, sent: r.filter((c) => c.status === 'sent').length, waiting: r.filter((c) => c.status === 'drafted').length };
  }, [rows, tab]);

  return (
    <div className="wrap">
      <h1>Kargo Hiring</h1>
      <p className="sub">Ranked against the pattern of Kargo&apos;s best hires. The system recommends — you decide. Nothing is sent until you click Send.</p>

      <div className="panel">
        <div className="row">
          <strong>Upload CVs</strong>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
            <option value="PM">Applied for: Product Manager</option>
            <option value="SPM">Applied for: Senior Product Manager</option>
          </select>
          <input id="cvs" type="file" multiple accept=".pdf,.docx,.txt" onChange={(e) => setFiles([...e.target.files])} disabled={busy} />
          <button className="primary" onClick={upload} disabled={busy || !files.length}>{busy ? 'Working…' : `Score ${files.length || ''} CV${files.length === 1 ? '' : 's'}`}</button>
          <button onClick={async () => { setBusy(true); setLog([]); try { await draftLoop(); } catch (e) { say(`✗ ${e.message}`); } setBusy(false); }} disabled={busy}>Refresh drafts</button>
        </div>
        <p className="note">Name, email and phone are separated on our server and never sent to the AI. Every CV is scored against both PM and SPM rubrics.</p>
        {log.length > 0 && <div className="log">{log.join('\n')}</div>}
      </div>

      {loadErr && <p className="err">Could not load candidates: {loadErr}</p>}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="tabs">
          {Object.keys(ROLES).map((r) => <button key={r} className={tab === r ? 'on' : ''} onClick={() => { setTab(r); setOpen(null); }}>{ROLES[r]} ({rows.filter((c) => c.applied_role === r).length})</button>)}
        </div>
        <div className="stats">
          <span><b>{counts.total}</b> candidates</span><span><b>{counts.invite}</b> to invite</span>
          <span><b>{counts.waiting}</b> awaiting your send</span><span><b>{counts.sent}</b> sent</span>
        </div>
      </div>

      {list.length === 0 && <div className="panel note">No {ROLES[tab]} candidates yet. Upload CVs above.</div>}
      {list.map((c, i) => (
        <Candidate key={c.id} c={c} rank={i + 1} tab={tab} line={i === SHORTLIST} open={open === c.id}
          toggle={() => setOpen(open === c.id ? null : c.id)} reload={load} />
      ))}
    </div>
  );
}

function Candidate({ c, rank, tab, line, open, toggle, reload }) {
  const [subj, setSubj] = useState(''); const [body, setBody] = useState('');
  const [msg, setMsg] = useState(''); const [working, setWorking] = useState(false);
  useEffect(() => { setSubj(c.email_subject || ''); setBody(c.email_body || ''); }, [c.email_subject, c.email_body]);

  const s = c.scores?.[tab]; const other = tab === 'PM' ? 'SPM' : 'PM'; const o = c.scores?.[other];
  const ready = c.status === 'drafted' && c.draft_for === c.decision;
  const pill = c.status === 'sent' ? ['sent', 'Sent'] : c.status === 'error' ? ['error', 'Error'] : !ready ? ['pending', 'Drafting…'] : [c.decision, c.decision === 'invite' ? 'Invite' : 'Reject'];

  async function act(fn, done) {
    setWorking(true); setMsg('');
    try { await fn(); setMsg(done || ''); await reload(); } catch (e) { setMsg('✗ ' + e.message); }
    setWorking(false);
  }
  const dirty = subj !== (c.email_subject || '') || body !== (c.email_body || '');
  const send = () => act(async () => { const r = await api('/api/send', { id: c.id, subject: subj, body }); setMsg(`✓ Sent to ${r.to}`); });
  const flip = (to) => act(async () => { await api('/api/decision', { id: c.id, action: to }); await api('/api/recompute', {}); }, `Switched to ${to}. New draft written.`);

  return (
    <div className={`cand${line ? ' line' : ''}`}>
      <div className="head" onClick={toggle}>
        <div className="rank">#{rank}</div>
        <div><div className="name">{c.name}</div><div className="fname">{c.source_filename}{c.decision_source === 'founder' ? ' · your call' : ''}</div></div>
        <div className="score">{s ? s.total : '—'}<small>{tab} score</small></div>
        <div className="score hide-sm" style={{ color: o && s && o.total > s.total + 5 ? 'var(--warn)' : undefined }}>{o ? o.total : '—'}<small>{other} score</small></div>
        <div className="hide-sm">{c.brief ? <span className="note">Brief ready</span> : null}</div>
        <div><span className={`pill ${pill[0]}`}>{pill[1]}</span></div>
      </div>

      {open && (
        <div className="body">
          <div>
            {c.brief && c.decision === 'invite' && <div className="brief"><h4>Interview brief</h4>{c.brief}</div>}
            {o && s && o.total > s.total + 5 && <p className="hint">Scores {o.total} on the {other} rubric — may fit {other} better.</p>}
            {s && <><h4>{tab} breakdown — {s.total}/100</h4>
              <table className="crit"><tbody>{s.criteria.map((k) => (
                <tr key={k.name}><td className="s">{k.score}/5</td><td><b>{k.name}</b> <span className="note">({k.weight}%)</span><br />{k.reason}</td></tr>
              ))}</tbody></table></>}
            {o && <details style={{ marginTop: 10 }}><summary className="note">{other} breakdown — {o.total}/100</summary>
              <table className="crit"><tbody>{o.criteria.map((k) => (
                <tr key={k.name}><td className="s">{k.score}/5</td><td><b>{k.name}</b> <span className="note">({k.weight}%)</span><br />{k.reason}</td></tr>
              ))}</tbody></table></details>}
            {c.error && <p className="err">Error: {c.error}</p>}
          </div>

          <div>
            <h4>Draft email {c.decision ? `(${c.decision === 'invite' ? 'interview invite' : 'rejection'})` : ''} → {c.email || 'no email found'}</h4>
            {c.status === 'sent' ? (
              <><p><b>{fill(c.email_subject, c.name)}</b></p><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{fill(c.email_body, c.name)}</pre>
                <p className="note">Sent {new Date(c.sent_at).toLocaleString()}</p></>
            ) : ready ? (
              <>
                <input className="subj" type="text" value={subj} onChange={(e) => setSubj(e.target.value)} />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} />
                <p className="note">[NAME] becomes “{first(c.name)}” when sent.</p>
                <div className="row">
                  <button className="primary" onClick={send} disabled={working || !c.email}>Send {c.decision === 'invite' ? 'invite' : 'rejection'}</button>
                  {dirty && <button onClick={() => act(() => api('/api/decision', { id: c.id, action: 'save', subject: subj, body }), 'Saved.')} disabled={working}>Save edits</button>}
                  <button onClick={() => flip(c.decision === 'invite' ? 'reject' : 'invite')} disabled={working}>Switch to {c.decision === 'invite' ? 'rejection' : 'invite'}</button>
                  <button onClick={() => act(async () => { await api('/api/decision', { id: c.id, action: 'redraft' }); await api('/api/recompute', {}); }, 'Redrafted.')} disabled={working}>Redraft</button>
                </div>
              </>
            ) : c.status === 'error' ? (
              <button onClick={() => act(async () => { await api('/api/decision', { id: c.id, action: 'retry' }); await api('/api/recompute', {}); }, 'Retried.')} disabled={working}>Retry</button>
            ) : <p className="note">Draft is being written — click “Refresh drafts” above if this persists.</p>}
            {msg && <p className={msg.startsWith('✗') ? 'err' : 'note'}>{msg}</p>}
            {c.status !== 'sent' && <p><button className="danger" onClick={() => confirm('Delete this candidate and their data?') && act(() => api('/api/decision', { id: c.id, action: 'delete' }))} disabled={working}>Delete candidate</button></p>}
          </div>
        </div>
      )}
    </div>
  );
}
