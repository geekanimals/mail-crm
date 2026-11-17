'use client';
// Employees: add a person (login + all HR details), change details, salary, reset password, block login, documents.
import { useState } from 'react';
import { LuCopy, LuKeyRound, LuPencil, LuPlus, LuTrash2, LuUserCheck, LuUserPlus, LuUserX } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';
import { AttachButton, Avatar, ConfirmDialog, FileList, PhotoPicker, fullDay, rupees, time } from '@/lib/hr';

const EMP = [
  ['code', 'Employee ID', 'GEEK-001'], ['department', 'Department', 'Marketing'], ['joiningDate', 'Joining date', '', 'date'],
  ['phone', 'Phone', ''], ['personalEmail', 'Personal email', ''], ['dob', 'Date of birth', '', 'date'], ['gender', 'Gender', ''],
  ['emergencyName', 'Emergency contact name', ''], ['emergencyPhone', 'Emergency contact phone', ''],
  ['pan', 'PAN', ''], ['bankName', 'Bank name', ''], ['bankAccount', 'Bank account no.', ''], ['ifsc', 'IFSC', ''],
];
const SAL = [['basic', 'Basic'], ['hra', 'HRA'], ['allowances', 'Allowances'], ['pt', 'Professional tax (monthly)'], ['tds', 'TDS (monthly)'], ['otherDeductions', 'Other deductions']];
const blankEmp = () => Object.fromEntries([...EMP.map(([k]) => [k, '']), ['address', ''], ['notes', '']]);
const blankSal = () => Object.fromEntries(SAL.map(([k]) => [k, '']));
const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = new Uint32Array(12);
  crypto.getRandomValues(pick);
  return Array.from(pick, (n) => chars[n % chars.length]).join('').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
};
const DOC_TYPES = ['Offer letter', 'Contract', 'ID proof', 'Address proof', 'PAN card', 'Certificate', 'Other'];

export default function People({ overview, team, reload }) {
  const [form, setForm] = useState(null); // add / edit
  const [made, setMade] = useState(null); // login details to share once
  const [reset, setReset] = useState(null);
  const [open, setOpen] = useState(null); // employee details panel
  const [ask, setAsk] = useState(null); // "are you sure?" pop-up
  const [show, setShow] = useState('active'); // active | inactive | all

  const startAdd = () => setForm({ name: '', title: '', email: '', password: makePassword(), employee: blankEmp(), salary: blankSal() });
  const startEdit = (m) => setForm({ _id: m._id, photo: m.photo || '', name: m.name, title: m.title || '', email: m.email, employee: { ...blankEmp(), ...(m.employee || {}) }, salary: { ...blankSal(), ...(m.salary || {}) } });

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form._id) {
        await api(`/api/team/${form._id}`, { method: 'PUT', body: { name: form.name, title: form.title, email: form.email, employee: form.employee, salary: form.salary } });
        notify('Saved');
      } else {
        const u = await api('/api/team', { method: 'POST', body: form });
        setMade({ name: u.name, email: u.email, password: form.password });
      }
      setForm(null);
      reload();
      if (open && form._id === open._id) showDetails(open._id);
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const update = async (m, body, msg) => {
    try {
      await api(`/api/team/${m._id}`, { method: 'PUT', body });
      if (msg) notify(msg);
      reload();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };
  // someone with open client tasks (estimate, execution, posts ...) must hand them over first
  const [handover, setHandover] = useState(null); // { m, action: 'delete' | 'deactivate', count, to }
  const withHandover = async (m, action, to) => {
    try {
      if (action === 'delete') await api(`/api/team/${m._id}`, { method: 'DELETE', body: to ? { handoverTo: to } : undefined });
      else await api(`/api/team/${m._id}`, { method: 'PUT', body: { active: false, ...(to ? { handoverTo: to } : {}) } });
      notify(action === 'delete' ? `${m.name} deleted` : `${m.name} deactivated`);
      setHandover(null);
      if (action === 'delete') setOpen(null);
      reload();
    } catch (e) {
      if (e.data?.handover) setHandover({ m, action, count: e.data.handover, to: '' });
      else notify(e.message, 'error');
    }
  };
  const remove = (m) => setAsk({
    title: `Are you sure you want to delete ${m.name}?`,
    text: 'Their login, attendance, leaves, tasks, weekly reports, targets, documents and salary slips will be removed for ever. This cannot be undone. If they have left the company and you want to keep their history, deactivate them instead.',
    confirm: 'Yes, delete',
    danger: true,
    run: () => withHandover(m, 'delete'),
  });
  const setActive = (m, active) => setAsk({
    title: active ? `Are you sure you want to activate ${m.name}?` : `Are you sure you want to deactivate ${m.name}?`,
    text: active
      ? 'They will be able to log in again and will appear in attendance, leaves, tasks, targets and payroll.'
      : 'Use this when they leave the company. They will not be able to log in, and will not appear in attendance, tasks, targets or new payroll. All their history is kept, and you can activate them again any time.',
    confirm: active ? 'Yes, activate' : 'Yes, deactivate',
    danger: !active,
    run: async () => {
      if (!active) return withHandover(m, 'deactivate');
      await api(`/api/team/${m._id}`, { method: 'PUT', body: { active } });
      notify(`${m.name} activated`);
      reload();
    },
  });
  const showDetails = (idv) => api(`/api/hr/employees/${idv}`).then(setOpen).catch((e) => notify(e.message, 'error'));
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify('Copied')).catch(() => {});
  const today = new Map((overview?.people || []).map((p) => [String(p._id), p]));
  const setE = (k, v) => setForm({ ...form, employee: { ...form.employee, [k]: v } });
  const setS = (k, v) => setForm({ ...form, salary: { ...form.salary, [k]: v } });
  const gross = form ? ['basic', 'hra', 'allowances'].reduce((n, k) => n + (Number(form.salary[k]) || 0), 0) : 0;

  return (
    <>
      <div className="row hr-toolbar">
        <p className="muted small">Each person logs in with their email and the password you set, then chooses their own password. There is no sign-up on the login page.</p>
        <button className="btn" onClick={startAdd}><LuUserPlus /> Add employee</button>
      </div>

      {made && (
        <div className="card tm-made">
          <h2>Login created for {made.name}</h2>
          <p className="muted small">Share these with {made.name}. They will be asked to set their own password at the first login.</p>
          <div className="tm-cred">
            <span>Website</span><b>{typeof window !== 'undefined' ? window.location.origin : ''}/login</b>
            <span>Email</span><b>{made.email}</b>
            <span>Password</span><b>{made.password}</b>
          </div>
          <div className="row">
            <button className="btn soft sm" onClick={() => copy(`Geek CRM login\n${window.location.origin}/login\nEmail: ${made.email}\nPassword: ${made.password}\n(You will be asked to choose your own password.)`)}><LuCopy /> Copy login details</button>
            <button className="btn ghost sm" onClick={() => setMade(null)}>Done</button>
          </div>
        </div>
      )}

      {form && (
        <form className="card hr-form" onSubmit={save}>
          <h2>{form._id ? `Edit ${form.name}` : 'New employee'}</h2>
          {form._id ? (
            <PhotoPicker name={form.name} photo={form.photo} forUser={form._id} btnClass="btn ghost sm" size={72} onSave={async (photo) => {
              await api(`/api/team/${form._id}`, { method: 'PUT', body: { photo } });
              setForm((f) => ({ ...f, photo }));
              reload();
            }} />
          ) : <p className="muted small">You can add a photo after the employee is created (Edit → Upload photo). The employee can also add their own.</p>}
          <p className="muted small">The employee can change their own phone, personal email, date of birth, gender, address and emergency contact from their profile. Everything else only you can change.</p>
          <h3>Login</h3>
          <div className="hr-grid">
            <label className="field">Full name *<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field">Designation<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Account manager" /></label>
            <label className="field">Email (login ID) *<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            {!form._id && (
              <label className="field">First password *
                <span className="tm-pass">
                  <input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, password: makePassword() })}>New</button>
                </span>
              </label>
            )}
          </div>
          <h3>Job and personal details</h3>
          <div className="hr-grid">
            {EMP.map(([k, l, ph, type]) => (
              <label className="field" key={k}>{l}
                {k === 'gender' ? (
                  <select value={form.employee.gender} onChange={(e) => setE('gender', e.target.value)}>
                    <option value="">—</option>
                    {['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => <option key={g}>{g}</option>)}
                  </select>
                ) : <input type={type || 'text'} value={form.employee[k]} placeholder={ph} onChange={(e) => setE(k, e.target.value)} />}
              </label>
            ))}
            <label className="field hr-wide">Address<textarea rows={2} value={form.employee.address} onChange={(e) => setE('address', e.target.value)} /></label>
            <label className="field hr-wide">Notes (only you see these)<textarea rows={2} value={form.employee.notes} onChange={(e) => setE('notes', e.target.value)} /></label>
          </div>
          <h3>Monthly salary (₹)</h3>
          <div className="hr-grid">
            {SAL.map(([k, l]) => (
              <label className="field" key={k}>{l}<input type="number" min="0" value={form.salary[k]} onChange={(e) => setS(k, e.target.value)} /></label>
            ))}
          </div>
          <p className="muted small">Gross per month: <b>{rupees(gross)}</b>. Absent days and unpaid leave are cut from the gross when the salary slip is made.</p>
          <div className="row">
            <button className="btn"><LuPlus /> {form._id ? 'Save changes' : 'Create employee'}</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {team && team.length > 0 && (
          <div className="tabs">
            {[['active', 'Active'], ['inactive', 'Deactivated'], ['all', 'All']].map(([k, l]) => (
              <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
                {l} ({team.filter((m) => (k === 'all' ? true : k === 'active' ? m.active : !m.active)).length})
              </button>
            ))}
          </div>
        )}
        {!team ? (
          <p className="muted">Loading…</p>
        ) : team.length === 0 ? (
          <p className="empty">No employees yet. Add your team to give them a login.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Name</th><th>Email (login)</th><th>Today</th><th>Open tasks</th><th>Last login</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {team.filter((m) => (show === 'all' ? true : show === 'active' ? m.active : !m.active)).map((m) => {
                  const t = today.get(String(m._id));
                  return (
                    <tr key={m._id} className={m.active ? '' : 'tm-off'}>
                      <td><div className="tm-who"><Avatar name={m.name} photo={m.photo} size={36} /><div><button className="hr-link" onClick={() => showDetails(m._id)}><b>{m.name}</b></button><small className="tm-sub">{[m.employee?.code, m.title].filter(Boolean).join(' · ')}</small></div></div></td>
                      <td data-label="Email">{m.email}{m.mustChangePassword && <small className="tm-sub">Has not set own password yet</small>}</td>
                      <td data-label="Today">{t?.onLeave ? <span className="badge paused">On leave</span> : t?.checkIn ? <span className="badge active">In {time(t.checkIn)}{t.checkOut ? ` · out ${time(t.checkOut)}` : ''}</span> : <span className="muted small">Not checked in</span>}</td>
                      <td data-label="Open tasks">{t?.openTasks || '—'}</td>
                      <td data-label="Last login">{m.lastLoginAt ? date(m.lastLoginAt) : 'Never'}</td>
                      <td data-label="Status">{m.active ? <span className="badge replied">Active</span> : <span className="badge unsubscribed">Deactivated</span>}</td>
                      <td data-label="Actions">
                        {reset?.id === m._id ? (
                          <form className="row tm-reset" onSubmit={async (e) => { e.preventDefault(); if (await update(m, { password: reset.password })) { setMade({ name: m.name, email: m.email, password: reset.password }); setReset(null); } }}>
                            <input minLength={8} required value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
                            <button className="btn sm">Save</button>
                            <button type="button" className="btn ghost sm" onClick={() => setReset(null)}>Cancel</button>
                          </form>
                        ) : (
                          <div className="row tm-actions">
                            <button className="btn ghost sm" onClick={() => startEdit(m)}><LuPencil /> Edit</button>
                            <button className="btn ghost sm" onClick={() => setReset({ id: m._id, password: makePassword() })}><LuKeyRound /> Reset password</button>
                            {m.active
                              ? <button className="btn ghost sm tm-del" onClick={() => setActive(m, false)}><LuUserX /> Deactivate</button>
                              : <button className="btn ghost sm" onClick={() => setActive(m, true)}><LuUserCheck /> Activate</button>}
                            <button className="btn ghost sm tm-del" onClick={() => remove(m)}><LuTrash2 /> Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {team.filter((m) => (show === 'all' ? true : show === 'active' ? m.active : !m.active)).length === 0 && <p className="empty">{show === 'inactive' ? 'No deactivated employees.' : 'No active employees.'}</p>}
          </div>
        )}
      </div>

      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
      {handover && (
        <div className="card tm-made">
          <h2>{handover.m.name} has {handover.count} open client task(s)</h2>
          <p className="muted small">Choose who takes them over before you {handover.action} {handover.m.name}. Each deal&apos;s timeline will show the hand-over.</p>
          <div className="row">
            <select value={handover.to} onChange={(e) => setHandover({ ...handover, to: e.target.value })}>
              <option value="">Choose an employee…</option>
              {(team || []).filter((x) => x.active && x._id !== handover.m._id).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
            </select>
            <button className="btn sm" disabled={!handover.to} onClick={() => withHandover(handover.m, handover.action, handover.to)}>Hand over and {handover.action}</button>
            <button className="btn ghost sm" onClick={() => setHandover(null)}>Cancel</button>
          </div>
        </div>
      )}

      {open && <Details e={open} onClose={() => setOpen(null)} onEdit={() => { startEdit(open); setOpen(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} reload={() => { showDetails(open._id); reload(); }} />}
    </>
  );
}

function Details({ e, onClose, onEdit, reload }) {
  const [doc, setDoc] = useState(null);
  const emp = e.employee || {};
  const sal = e.salary || {};
  const addDoc = async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/hr/documents', { method: 'POST', body: { user: e._id, name: doc.name, category: doc.category, file: doc.file?.id, link: doc.link } });
      notify('Document saved');
      setDoc(null);
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const [ask, setAsk] = useState(null);
  const delDoc = (d) => setAsk({
    title: `Are you sure you want to delete "${d.name}"?`,
    text: 'The document is removed for ever.',
    confirm: 'Yes, delete',
    danger: true,
    run: async () => {
      await api(`/api/hr/documents/${d._id}`, { method: 'DELETE' });
      reload();
    },
  });
  return (
    <div className="hr-overlay" onClick={onClose}>
      <div className="hr-panel" onClick={(ev) => ev.stopPropagation()}>
        <div className="row hr-panel-head">
          <div className="tm-who"><Avatar name={e.name} photo={e.photo} size={52} /><div><h2>{e.name}</h2><p className="muted small">{[emp.code, e.title, emp.department].filter(Boolean).join(' · ') || 'No details yet'}</p></div></div>
          <div className="row"><button className="btn ghost sm" onClick={onEdit}><LuPencil /> Edit</button><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        </div>
        <PhotoPicker name={e.name} photo={e.photo} forUser={e._id} btnClass="btn ghost sm" avatar={false} onSave={async (photo) => {
          await api(`/api/team/${e._id}`, { method: 'PUT', body: { photo } });
          reload();
        }} />
        <h3>Paid leave {e.balance?.year}</h3>
        <div className="hr-stats">
          <div><b>{e.balance?.available ?? 0}</b><span>Available</span></div>
          <div><b>{e.balance?.earned ?? 0}</b><span>Earned</span></div>
          <div><b>{e.balance?.used ?? 0}</b><span>Used</span></div>
          <div><b>{e.balance?.unpaid ?? 0}</b><span>Unpaid days</span></div>
        </div>
        <h3>Details</h3>
        <dl className="hr-dl">
          <dt>Email</dt><dd>{e.email}</dd>
          {EMP.map(([k, l, , type]) => emp[k] ? <div className="hr-pair" key={k}><dt>{l}</dt><dd>{type === 'date' ? fullDay(emp[k]) : emp[k]}</dd></div> : null)}
          {emp.address && <><dt>Address</dt><dd>{emp.address}</dd></>}
          {emp.notes && <><dt>Notes</dt><dd>{emp.notes}</dd></>}
        </dl>
        <h3>Salary (monthly)</h3>
        <dl className="hr-dl">
          {SAL.map(([k, l]) => <div className="hr-pair" key={k}><dt>{l}</dt><dd>{rupees(sal[k])}</dd></div>)}
          <dt>Gross</dt><dd><b>{rupees((sal.basic || 0) + (sal.hra || 0) + (sal.allowances || 0))}</b></dd>
        </dl>
        <div className="row hr-between"><h3>Documents</h3>{!doc && <button className="btn ghost sm" onClick={() => setDoc({ name: '', category: 'Contract', link: '', file: null })}><LuPlus /> Add document</button>}</div>
        {doc && (
          <form className="hr-docform" onSubmit={addDoc}>
            <label className="field">Name<input required value={doc.name} onChange={(ev) => setDoc({ ...doc, name: ev.target.value })} placeholder="Offer letter" /></label>
            <label className="field">Type<select value={doc.category} onChange={(ev) => setDoc({ ...doc, category: ev.target.value })}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field hr-wide">Google Drive / other link<input value={doc.link} onChange={(ev) => setDoc({ ...doc, link: ev.target.value })} placeholder="https://drive.google.com/…" disabled={Boolean(doc.file)} /></label>
            <div className="row hr-wide">
              {doc.file ? <FileList files={[doc.file]} onRemove={() => setDoc({ ...doc, file: null })} /> : <AttachButton className="btn ghost sm" forUser={e._id} multiple={false} label="Or upload a file" onAdd={([f]) => setDoc({ ...doc, file: f, link: '' })} />}
            </div>
            <div className="row hr-wide"><button className="btn sm">Save document</button><button type="button" className="btn ghost sm" onClick={() => setDoc(null)}>Cancel</button></div>
          </form>
        )}
        {e.documents.length === 0 && !doc && <p className="muted small">No documents yet.</p>}
        {e.documents.map((d) => (
          <div key={d._id} className="hr-item">
            <div><b>{d.name}</b><small>{d.category} · added by {d.uploadedBy} · {date(d.createdAt)}</small></div>
            <div className="row">
              {d.file?.id ? <FileList files={[d.file]} /> : <a className="hr-a" href={d.link} target="_blank" rel="noopener noreferrer">Open link</a>}
              <button className="btn ghost sm tm-del" onClick={() => delDoc(d)}><LuTrash2 /></button>
            </div>
          </div>
        ))}
        <h3>Job history</h3>
        {(e.history || []).length === 0 && <p className="muted small">Nothing yet.</p>}
        {[...(e.history || [])].reverse().map((h, i) => <div key={i} className="hr-item"><div><b>{h.text}</b><small>{fullDay(h.date)}</small></div></div>)}
        <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
      </div>
    </div>
  );
}
