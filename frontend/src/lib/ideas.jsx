'use client';
// Idea Bucket - the same board for every login. The look follows the area it sits in:
// admin (blue), employee portal (warm, via body.emp-theme), Insights (green, tone="insights"), client portal (blue).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LuArrowUp, LuCheck, LuChevronRight, LuLightbulb, LuMessageCircle, LuPaperclip, LuPencil, LuPlus, LuSearch, LuSend, LuTrash2, LuX,
} from 'react-icons/lu';
import { api } from '@/lib/api';
import { openFile, uploadFile } from '@/lib/hr';

const when = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} d ago` : when(d);
};
const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const KIND = { admin: 'Admin', team: 'Team', insights: 'Insights', client: 'Client' };

function Pill({ status, label }) {
  return <span className={`ib-pill s-${status}`}>{label}</span>;
}

/* ---------------- share an idea ---------------- */
function Composer({ categories, onClose, onSaved, say, edit, tone }) {
  const [f, setF] = useState(edit ? { title: edit.title, detail: edit.detail, category: edit.category } : { title: '', detail: '', category: categories[0] });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const pick = useRef(null);
  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      let idea = await api(edit ? `/api/ideas/${edit._id}` : '/api/ideas', { method: edit ? 'PUT' : 'POST', body: f });
      if (files.length) {
        const up = [];
        for (const file of files) up.push(await uploadFile(file, undefined, undefined, idea._id));
        idea = await api(`/api/ideas/${idea._id}/files`, { method: 'POST', body: { files: up.map((u) => String(u.id)) } });
      }
      say(edit ? 'Idea updated' : 'Thanks! Your idea is in the bucket');
      onSaved(idea);
    } catch (err) {
      say(err.message, 'error');
    }
    setBusy(false);
  };
  return createPortal(
    <div className={`ib-overlay ${tone}`} onClick={onClose}>
      <form className="ib-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="ib-row ib-between">
          <h2><LuLightbulb /> {edit ? 'Edit your idea' : 'Share an idea'}</h2>
          <button type="button" className="ib-icon" onClick={onClose} aria-label="Close"><LuX /></button>
        </div>
        <p className="ib-muted">A new feature, something that annoys you, or a better way of working - every idea helps.</p>
        <label className="ib-field">Title
          <input autoFocus required minLength={4} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Send follow-ups on WhatsApp too" />
        </label>
        <div className="ib-field">Category
          <div className="ib-chips">
            {categories.map((c) => <button type="button" key={c} className={f.category === c ? 'on' : ''} onClick={() => setF({ ...f, category: c })}>{c}</button>)}
          </div>
        </div>
        <label className="ib-field">Details
          <textarea required rows={5} maxLength={5000} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="What should it do, and why would it help?" />
        </label>
        {!edit && (
          <div className="ib-row">
            <input ref={pick} type="file" hidden multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.pptx,.txt" onChange={(e) => { setFiles([...files, ...e.target.files].slice(0, 5)); e.target.value = ''; }} />
            <button type="button" className="ib-btn ghost" onClick={() => pick.current?.click()}><LuPaperclip /> Attach screenshot or file</button>
            {files.map((x, i) => <span key={i} className="ib-chip">{x.name}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><LuX /></button></span>)}
          </div>
        )}
        <div className="ib-row ib-end">
          <button type="button" className="ib-btn ghost" onClick={onClose}>Cancel</button>
          <button className="ib-btn" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Share idea'}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

/* ---------------- one idea ---------------- */
function Detail({ id, statuses, onClose, onChanged, say, onEdit, tone }) {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState(null);
  const [sure, setSure] = useState(false);
  const load = useCallback(() => api(`/api/ideas/${id}`).then(setD).catch((e) => say(e.message, 'error')), [id, say]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (fn, msg) => {
    try {
      const out = await fn();
      if (out?._id) setD(out);
      if (msg) say(msg);
      onChanged();
      return true;
    } catch (e) {
      say(e.message, 'error');
      return false;
    }
  };
  const isAdmin = Boolean(statuses);
  return createPortal(
    <div className={`ib-overlay right ${tone}`} onClick={onClose}>
      <div className="ib-panel" onClick={(e) => e.stopPropagation()}>
        {!d ? <p className="ib-muted">Loading…</p> : (
          <>
            <div className="ib-row ib-between">
              <div className="ib-row"><Pill status={d.status} label={d.statusLabel} /><span className="ib-tag">{d.category}</span></div>
              <button className="ib-icon" onClick={onClose} aria-label="Close"><LuX /></button>
            </div>
            <h2 className="ib-dtitle">{d.title}</h2>
            <div className="ib-meta">
              <span className="ib-ava">{initials(d.author.name)}</span>
              <span><b>{d.author.name}</b> · {KIND[d.author.kind]}{d.company ? ` · ${d.company}` : ''} · {when(d.createdAt)}</span>
            </div>
            <p className="ib-detail">{d.detail}</p>
            {d.files.length > 0 && (
              <div className="ib-row">{d.files.map((f) => <button key={f.id} className="ib-btn ghost sm" onClick={() => openFile(f).catch((e) => say(e.message, 'error'))}><LuPaperclip /> {f.name}</button>)}</div>
            )}
            <div className="ib-row">
              <button className={`ib-vote big ${d.voted ? 'on' : ''}`} onClick={() => act(() => api(`/api/ideas/${d._id}/vote`, { method: 'POST' }))}><LuArrowUp /> {d.votes} {d.votes === 1 ? 'vote' : 'votes'}</button>
              {d.canEdit && d.status === 'new' && d.mine && <button className="ib-btn ghost sm" onClick={() => onEdit(d)}><LuPencil /> Edit</button>}
              {d.canEdit && (sure ? (
                <>
                  <span className="ib-muted">Delete this idea for good?</span>
                  <button className="ib-btn danger sm" onClick={async () => { if (await act(() => api(`/api/ideas/${d._id}`, { method: 'DELETE' }), 'Idea deleted')) onClose(); }}>Yes, delete</button>
                  <button className="ib-btn ghost sm" onClick={() => setSure(false)}>Cancel</button>
                </>
              ) : <button className="ib-btn ghost sm" onClick={() => setSure(true)}><LuTrash2 /> Delete</button>)}
            </div>

            {d.adminNote && note === null && <div className="ib-note"><b>Note from the admin</b><span>{d.adminNote}</span></div>}

            {statuses && (
              <section className="ib-admin">
                <b>Admin</b>
                <div className="ib-stages">
                  {statuses.map((s) => (
                    <button key={s.key} className={`s-${s.key} ${d.status === s.key ? 'on' : ''}`} onClick={() => act(() => api(`/api/ideas/${d._id}`, { method: 'PUT', body: { status: s.key } }), `Moved to ${s.label}`)}>
                      {d.status === s.key && <LuCheck />} {s.label}
                    </button>
                  ))}
                </div>
                {note === null ? (
                  <button className="ib-btn ghost sm" onClick={() => setNote(d.adminNote || '')}><LuPencil /> {d.adminNote ? 'Edit note' : 'Add a note for the team'}</button>
                ) : (
                  <form className="ib-row" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api(`/api/ideas/${d._id}`, { method: 'PUT', body: { adminNote: note } }), 'Note saved')) setNote(null); }}>
                    <input className="ib-grow" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Good one - planned for next month" />
                    <button className="ib-btn sm">Save</button>
                    <button type="button" className="ib-btn ghost sm" onClick={() => setNote(null)}>Cancel</button>
                  </form>
                )}
              </section>
            )}

            <section className="ib-sec">
              <h3><LuMessageCircle /> Comments ({d.commentList.length})</h3>
              {d.commentList.length === 0 && <p className="ib-muted">No comments yet. Add a thought or a vote of support.</p>}
              {d.commentList.map((c) => (
                <div key={c._id} className={`ib-comment ${c.kind === 'admin' ? 'admin' : ''}`}>
                  <span className="ib-ava sm">{initials(c.name)}</span>
                  <div className="ib-grow">
                    <div className="ib-row ib-between"><b>{c.name}{c.kind === 'admin' ? ' · Admin' : ''}</b><small>{ago(c.at)}</small></div>
                    <p>{c.text}</p>
                  </div>
                  {(c.mine || isAdmin) && <button className="ib-icon sm" title="Delete comment" onClick={() => act(() => api(`/api/ideas/${d._id}/comments/${c._id}`, { method: 'DELETE' }))}><LuTrash2 /></button>}
                </div>
              ))}
              <form className="ib-row" onSubmit={async (e) => { e.preventDefault(); if (text.trim() && (await act(() => api(`/api/ideas/${d._id}/comments`, { method: 'POST', body: { text } })))) setText(''); }}>
                <input className="ib-grow" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…" />
                <button className="ib-btn sm" disabled={!text.trim()}><LuSend /> Send</button>
              </form>
            </section>

            <section className="ib-sec">
              <h3>History</h3>
              <ol className="ib-history">
                {d.history.map((h, i) => <li key={i}><Pill status={h.status} label={h.label} /><span>{h.by} · {when(h.at)}</span></li>)}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ---------------- the board ---------------- */
export default function IdeaBucket({ tone = '', bare = false }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState({ status: '', category: '', mine: false, sort: 'new', q: '' });
  const [compose, setCompose] = useState(null); // {} new | idea to edit
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const say = useCallback((text, type = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  }, []);
  const load = useCallback(() => {
    api('/api/ideas', { query: { status: filter.status, category: filter.category, mine: filter.mine ? '1' : '', sort: filter.sort, q: filter.q } })
      .then(setData)
      .catch((e) => say(e.message, 'error'));
  }, [filter, say]);
  useEffect(() => {
    const t = setTimeout(load, filter.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, filter.q]);

  const vote = async (e, i) => {
    e.stopPropagation();
    try {
      await api(`/api/ideas/${i._id}/vote`, { method: 'POST' });
      load();
    } catch (err) {
      say(err.message, 'error');
    }
  };

  return (
    <div className={`ib ${tone}`}>
      <style>{css}</style>
      <div className={`ib-hero ${bare ? 'bare' : ''}`}>
        {!bare && <div className="ib-heroicon"><LuLightbulb /></div>}
        <div className="ib-grow">
          {!bare && <h1>Idea Bucket</h1>}
          <p>Share ideas to make Geek better - new features, fixes and better ways of working. Vote for the ones you like.</p>
        </div>
        <button className="ib-btn big" onClick={() => setCompose({})}><LuPlus /> Share an idea</button>
      </div>

      {data && (
        <div className="ib-stats">
          <div><b>{data.stats.total}</b><span>Ideas shared</span></div>
          <div><b>{data.stats.new}</b><span>New</span></div>
          <div><b>{data.stats.planned}</b><span>Planned / in progress</span></div>
          <div className="done"><b>{data.stats.done}</b><span>Done</span></div>
        </div>
      )}

      <div className="ib-bar">
        <label className="ib-search"><LuSearch /><input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search ideas" /></label>
        <div className="ib-chips scroll">
          <button className={!filter.status ? 'on' : ''} onClick={() => setFilter({ ...filter, status: '' })}>All</button>
          {data?.statuses.map((s) => <button key={s.key} className={filter.status === s.key ? 'on' : ''} onClick={() => setFilter({ ...filter, status: s.key })}>{s.label}</button>)}
        </div>
        <div className="ib-row">
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All categories</option>
            {data?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.target.value })}>
            <option value="new">Newest first</option>
            <option value="top">Most votes</option>
          </select>
          <button className={`ib-toggle ${filter.mine ? 'on' : ''}`} onClick={() => setFilter({ ...filter, mine: !filter.mine })}>My ideas</button>
        </div>
      </div>

      {!data ? <p className="ib-muted">Loading…</p> : data.list.length === 0 ? (
        <div className="ib-empty">
          <LuLightbulb />
          <b>{filter.status || filter.category || filter.mine || filter.q ? 'No ideas match these filters' : 'The bucket is empty'}</b>
          <span>{filter.status || filter.category || filter.mine || filter.q ? 'Try another filter.' : 'Be the first to share an idea.'}</span>
          <button className="ib-btn" onClick={() => setCompose({})}><LuPlus /> Share an idea</button>
        </div>
      ) : (
        <div className="ib-grid">
          {data.list.map((i) => (
            <article key={i._id} className="ib-card" onClick={() => setOpen(i._id)}>
              <button className={`ib-vote ${i.voted ? 'on' : ''}`} onClick={(e) => vote(e, i)} title={i.voted ? 'Remove your vote' : 'Vote for this idea'}>
                <LuArrowUp /><b>{i.votes}</b>
              </button>
              <div className="ib-cbody">
                <div className="ib-row"><Pill status={i.status} label={i.statusLabel} /><span className="ib-tag">{i.category}</span>{i.mine && <span className="ib-tag mine">Yours</span>}</div>
                <h3>{i.title}</h3>
                <p>{i.detail}</p>
                {i.adminNote && <div className="ib-note sm"><b>Admin:</b> {i.adminNote}</div>}
                <div className="ib-foot">
                  <span className="ib-ava sm">{initials(i.author.name)}</span>
                  <span className="ib-grow">{i.author.name}{i.company ? ` · ${i.company}` : ''} · {ago(i.createdAt)}</span>
                  {i.files > 0 && <span className="ib-count"><LuPaperclip /> {i.files}</span>}
                  <span className="ib-count"><LuMessageCircle /> {i.comments}</span>
                  <LuChevronRight className="ib-go" />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {compose && (
        <Composer
          tone={tone}
          categories={data?.categories || ['Other']}
          edit={compose._id ? compose : null}
          say={say}
          onClose={() => setCompose(null)}
          onSaved={(idea) => {
            setCompose(null);
            load();
            setOpen(idea._id);
          }}
        />
      )}
      {open && (
        <Detail
          key={open}
          tone={tone}
          id={open}
          statuses={data?.isAdmin ? data.statuses : null}
          say={say}
          onClose={() => setOpen(null)}
          onChanged={load}
          onEdit={(d) => {
            setOpen(null);
            setCompose(d);
          }}
        />
      )}
      {toast && createPortal(<div className={`ib-toast ${toast.type}`}>{toast.text}</div>, document.body)}
    </div>
  );
}

const css = `
.ib, .ib-overlay, .ib-toast { --a: #1aa9c8; --a2: #4fcde7; --ad: #0b87a5; --soft: #e0f7fc; --ink: #0f2a33; --muted: #64748b; --card: rgba(255,255,255,.78); --line: rgba(148,163,184,.25); --btn: linear-gradient(150deg, var(--a2), var(--a)); --btnink: #fff; }
.ib.insights, .ib-overlay.insights { --a: #2d6a5f; --a2: #4f9486; --ad: #24564d; --soft: #e3f0ec; --ink: #17302b; --muted: #5d7a72; --btn: linear-gradient(150deg, #4f9486, #2d6a5f); }
body.emp-theme .ib, body.emp-theme .ib-overlay, body.emp-theme .ib-toast { --a: #c27c4f; --a2: #dfa47a; --ad: #9a5a33; --soft: #f3dfcf; --ink: #26221f; --muted: #8c847d; --card: rgba(255,255,255,.55); --line: rgba(120,90,60,.14); --btn: #26221f; }
.ib { display: flex; flex-direction: column; gap: 16px; color: var(--ink); min-width: 0; }
.ib h1, .ib h2, .ib h3 { margin: 0; color: var(--ink); }
.ib-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.ib-between { justify-content: space-between; } .ib-end { justify-content: flex-end; }
.ib-grow { flex: 1; min-width: 0; }
.ib-muted { color: var(--muted); font-size: 13.5px; margin: 0; }
.ib-hero { display: flex; align-items: center; gap: 16px; padding: 20px 22px; border-radius: 22px; background: var(--card); border: 1px solid rgba(255,255,255,.8); box-shadow: 0 14px 40px rgba(30,41,59,.07); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); flex-wrap: wrap; }
.ib-heroicon { width: 54px; height: 54px; border-radius: 18px; display: grid; place-items: center; font-size: 26px; color: #fff; background: var(--btn); box-shadow: 0 10px 24px rgba(0,0,0,.12); flex: none; }
.ib-hero h1 { font-size: 24px; letter-spacing: -.02em; }
.ib-hero.bare { padding: 14px 18px; }
.ib-hero.bare p { margin: 0; }
.ib-hero p { margin: 3px 0 0; color: var(--muted); font-size: 14px; }
.ib-btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: 12px; padding: 9px 15px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; background: var(--btn); color: var(--btnink); white-space: nowrap; }
.ib-btn.big { padding: 12px 18px; border-radius: 14px; font-size: 15px; box-shadow: 0 10px 24px rgba(0,0,0,.12); }
.ib-btn.sm { padding: 6px 11px; font-size: 13px; border-radius: 10px; }
.ib-btn.ghost { background: rgba(255,255,255,.85); color: var(--ink); border-color: var(--line); }
.ib-btn.danger { background: #e11d48; }
.ib-btn:disabled { opacity: .55; cursor: not-allowed; }
.ib-icon { border: 0; background: rgba(255,255,255,.7); width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; cursor: pointer; color: var(--ink); font-size: 17px; flex: none; }
.ib-icon.sm { width: 28px; height: 28px; font-size: 14px; background: none; color: var(--muted); }
.ib-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.ib-stats > div { background: var(--card); border: 1px solid rgba(255,255,255,.8); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; box-shadow: 0 10px 28px rgba(30,41,59,.05); }
.ib-stats b { font-size: 26px; letter-spacing: -.02em; }
.ib-stats span { font-size: 12.5px; color: var(--muted); }
.ib-stats .done b { color: #15803d; }
.ib-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.ib-search { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; background: rgba(255,255,255,.85); border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; color: var(--muted); }
.ib-search input { border: 0; background: none; outline: none; font: inherit; font-size: 14px; padding: 10px 0; flex: 1; min-width: 0; color: var(--ink); }
.ib select, .ib-modal input, .ib-modal textarea, .ib-panel input { font: inherit; font-size: 14px; padding: 9px 11px; border-radius: 11px; border: 1px solid var(--line); background: rgba(255,255,255,.9); color: var(--ink); min-width: 0; }
.ib-bar select { width: auto; min-width: 150px; flex: none; }
.ib-bar .ib-row { flex-wrap: nowrap; }
.ib-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ib-chips.scroll { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; padding-bottom: 2px; }
.ib-chips button, .ib-toggle { border: 1px solid var(--line); background: rgba(255,255,255,.75); color: var(--ink); border-radius: 99px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ib-chips button.on, .ib-toggle.on { background: var(--btn); color: var(--btnink); border-color: transparent; }
.ib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.ib-card { display: flex; gap: 14px; padding: 16px; border-radius: 20px; background: var(--card); border: 1px solid rgba(255,255,255,.8); box-shadow: 0 12px 34px rgba(30,41,59,.06); cursor: pointer; transition: transform .15s, box-shadow .15s; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); min-width: 0; }
.ib-card:hover { transform: translateY(-2px); box-shadow: 0 18px 44px rgba(30,41,59,.10); }
.ib-cbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.ib-card h3 { font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
.ib-card p { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.ib-vote { flex: none; width: 52px; height: 60px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,.85); color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font: inherit; cursor: pointer; font-size: 16px; transition: background .15s; }
.ib-vote b { font-size: 15px; color: var(--ink); }
.ib-vote.on { background: var(--soft); border-color: var(--a); color: var(--ad); }
.ib-vote.on b { color: var(--ad); }
.ib-vote.big { width: auto; height: auto; flex-direction: row; padding: 8px 14px; gap: 6px; font-size: 14px; font-weight: 700; color: var(--ink); }
.ib-foot { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.ib-count { display: inline-flex; align-items: center; gap: 3px; }
.ib-go { color: var(--muted); }
.ib-ava { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-size: 12.5px; font-weight: 700; color: #fff; background: var(--btn); flex: none; }
.ib-ava.sm { width: 24px; height: 24px; font-size: 10px; }
.ib-tag { font-size: 11.5px; font-weight: 600; color: var(--muted); background: rgba(148,163,184,.14); padding: 3px 9px; border-radius: 99px; }
.ib-tag.mine { background: var(--soft); color: var(--ad); }
.ib-pill { font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 99px; white-space: nowrap; }
.s-new { background: #e0f2fe; color: #0369a1; } .s-review { background: #fef3c7; color: #a16207; } .s-planned { background: #ede9fe; color: #6d28d9; }
.s-progress { background: #dbeafe; color: #1d4ed8; } .s-done { background: #dcfce7; color: #15803d; } .s-notnow { background: #f1f5f9; color: #64748b; }
.ib-note { display: flex; flex-direction: column; gap: 3px; background: var(--soft); color: var(--ink); border-radius: 12px; padding: 10px 12px; font-size: 13.5px; }
.ib-note.sm { display: block; padding: 7px 10px; font-size: 12.5px; }
.ib-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 50px 20px; border-radius: 22px; background: var(--card); border: 1px dashed var(--line); color: var(--muted); }
.ib-empty svg { font-size: 34px; color: var(--a); }
.ib-empty b { color: var(--ink); font-size: 16px; }
/* modal + side panel */
.ib-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(15,23,42,.35); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 16px; color: var(--ink); }
body.emp-theme .ib-overlay { background: rgba(60,40,25,.30); }
.ib-overlay.right { justify-content: flex-end; padding: 0; align-items: stretch; }
.ib-modal { width: min(620px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: #fff; border-radius: 22px; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 30px 80px rgba(0,0,0,.25); }
body.emp-theme .ib-modal, body.emp-theme .ib-panel { background: #f8f2ec; }
.ib-modal h2, .ib-panel h2 { display: flex; align-items: center; gap: 8px; font-size: 20px; margin: 0; }
.ib-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
.ib-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--soft); color: var(--ad); border-radius: 99px; padding: 4px 6px 4px 10px; font-size: 12.5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ib-chip button { border: 0; background: none; color: inherit; cursor: pointer; display: inline-flex; }
.ib-panel { width: min(640px, 100%); height: 100%; overflow-y: auto; background: #f7fbfd; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: -20px 0 60px rgba(0,0,0,.18); }
.ib-dtitle { font-size: 22px !important; line-height: 1.3; overflow-wrap: anywhere; }
.ib-meta { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.ib-meta b { color: var(--ink); }
.ib-detail { margin: 0; white-space: pre-wrap; line-height: 1.6; font-size: 14.5px; overflow-wrap: anywhere; }
.ib-admin { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.8); border: 1px dashed var(--a); }
.ib-stages { display: flex; gap: 6px; flex-wrap: wrap; }
.ib-stages button { border: 1px solid transparent; border-radius: 99px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; opacity: .55; display: inline-flex; align-items: center; gap: 4px; }
.ib-stages button.on { opacity: 1; border-color: currentColor; }
.ib-sec { display: flex; flex-direction: column; gap: 10px; padding-top: 6px; border-top: 1px solid var(--line); }
.ib-sec h3 { display: flex; align-items: center; gap: 6px; font-size: 15px; }
.ib-comment { display: flex; gap: 10px; align-items: flex-start; background: rgba(255,255,255,.75); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
.ib-comment.admin { border-color: var(--a); }
.ib-comment p { margin: 3px 0 0; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ib-comment small { color: var(--muted); font-size: 12px; }
.ib-history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ib-history li { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
.ib-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 120; background: #0f172a; color: #fff; padding: 10px 16px; border-radius: 12px; font-size: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.ib-toast.error { background: #be123c; }
@media (max-width: 900px) { .ib-toast { bottom: calc(96px + env(safe-area-inset-bottom)); } }
@media (max-width: 700px) {
  .ib-stats { grid-template-columns: 1fr 1fr; }
  .ib-hero { padding: 16px; gap: 12px; }
  .ib-hero h1 { font-size: 20px; }
  .ib-btn.big { width: 100%; justify-content: center; }
  .ib-grid { grid-template-columns: 1fr; }
  .ib-bar .ib-row { flex-wrap: wrap; width: 100%; }
  .ib-bar select { flex: 1; min-width: 0; }
  .ib-card { padding: 14px; gap: 12px; }
  .ib-vote { width: 46px; height: 54px; }
  .ib-panel, .ib-modal { padding: 16px; }
  .ib-modal { max-height: calc(100vh - 20px); }
}
`;
