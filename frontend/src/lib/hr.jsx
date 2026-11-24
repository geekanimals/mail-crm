'use client';
// Helpers shared by the admin Employees page and the employee portal: files, dates, money, the payslip.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL, getToken, notify } from '@/lib/api';

export const TZ = 'Asia/Kolkata';
export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const thisMonth = () => todayStr().slice(0, 7);
export const rupees = (n) => `₹${new Intl.NumberFormat('en-IN').format(Math.round(n || 0))}`;
export const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
export const hhmm = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)) : '');
export const dayLabel = (day) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }) : '—');
export const fullDay = (day) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const monthLabel = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : '');
export const hours = (a, b) => {
  if (!a || !b) return '';
  const m = Math.round((new Date(b) - new Date(a)) / 60000);
  return m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : '';
};
export const shiftMonth = (m, n) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const addDay = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (day) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDay(day, dow === 0 ? -6 : 1 - dow);
};
export const STATUS = {
  present: ['Present', '#16a34a'],
  absent: ['Absent', '#e11d48'],
  leave: ['Leave', '#7c3aed'],
  'half-leave': ['Half-day leave', '#a855f7'],
  holiday: ['Holiday', '#0ea5e9'],
  off: ['Sunday', '#94a3b8'],
  today: ['Today', '#f59e0b'],
  future: ['', '#cbd5e1'],
  'before-join': ['Before joining', '#cbd5e1'],
};

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });

/** upload one file -> { id, name, size, type }. forUser = employee id (admin uploading for someone) */
export async function uploadFile(file, forUser, deal, idea) {
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is bigger than 10 MB`);
  const data = await toBase64(file);
  const res = await fetch(`${API_URL}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ name: file.name, type: file.type, data, for: forUser, deal, idea }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error || `Upload failed (${res.status})`);
  return out;
}

/* ---------------- profile photos ---------------- */
const photoCache = new Map(); // file id -> object URL (or a pending promise)
function loadPhoto(id) {
  if (!photoCache.has(id)) {
    photoCache.set(
      id,
      fetch(`${API_URL}/api/files/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? URL.createObjectURL(b) : ''))
        .catch(() => '')
    );
  }
  return photoCache.get(id);
}
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** round photo, or initials when there is none (photo files need the login token, so they load through fetch) */
export function Avatar({ name, photo, size = 40, className = '' }) {
  const [src, setSrc] = useState({ id: '', url: '' });
  useEffect(() => {
    let live = true;
    if (photo) loadPhoto(photo).then((url) => live && setSrc({ id: photo, url }));
    return () => {
      live = false;
    };
  }, [photo]);
  const url = photo && src.id === photo ? src.url : '';
  return (
    <span className={`hr-avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-label={name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : initials(name)}
      <style>{`.hr-avatar { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 50%; overflow: hidden; background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; font-weight: 700; letter-spacing: .02em; }
.hr-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }`}</style>
    </span>
  );
}

/** shrink a picked image to a 512px JPEG before upload, so photos stay small */
async function squarePhoto(file) {
  if (!/^image\//.test(file.type)) throw new Error('Choose an image (JPG, PNG or WEBP)');
  const img = await new Promise((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => bad(new Error('This image could not be read. Try a JPG or PNG.'));
    i.src = URL.createObjectURL(file);
  });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const out = Math.min(512, side);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
  if (!blob) throw new Error('This image could not be read. Try a JPG or PNG.');
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

/** photo with Change / Remove. onSave(fileId | '') stores it on the profile. */
export function PhotoPicker({ name, photo, forUser, onSave, size = 84, btnClass = 'pt-btn', avatar = true }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(await squarePhoto(file), forUser);
      await onSave(String(up.id));
      notify('Photo updated ✓');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await onSave('');
      notify('Photo removed');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className="hr-photo">
      {avatar && <Avatar name={name} photo={photo} size={size} />}
      <div className="hr-photo-btns">
        <button type="button" className={btnClass} disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Saving…' : photo ? 'Change photo' : 'Upload photo'}</button>
        {photo && <button type="button" className={btnClass} disabled={busy} onClick={remove}>Remove</button>}
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      </div>
      <style>{`.hr-photo { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.hr-photo-btns { display: flex; gap: 8px; flex-wrap: wrap; }`}</style>
    </div>
  );
}

/** download a stored file (needs the login token, so it goes through fetch) */
export async function openFile(f) {
  try {
    const res = await fetch(`${API_URL}/api/files/${f.id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not open the file');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    notify(e.message, 'error');
  }
}

export const sizeOf = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

/** list of attached files with download (and remove, when onRemove is given) */
export function FileList({ files, onRemove }) {
  if (!files?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {files.map((f, i) => (
        <span key={f.id || i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '4px 10px', borderRadius: 99, background: '#effafc', border: '1px solid rgba(50,193,223,.3)' }}>
          <button type="button" onClick={() => openFile(f)} style={{ background: 'none', border: 0, color: '#0b87a5', fontWeight: 600, cursor: 'pointer', padding: 0, font: 'inherit' }} title="Download">
            📎 {f.name}
          </button>
          <span style={{ color: '#94a3b8' }}>{sizeOf(f.size)}</span>
          {onRemove && <button type="button" onClick={() => onRemove(i)} style={{ background: 'none', border: 0, color: '#e11d48', cursor: 'pointer', padding: 0 }} aria-label="Remove">✕</button>}
        </span>
      ))}
    </div>
  );
}

/** "Attach files" button: uploads straight away and hands back the stored files */
export function AttachButton({ onAdd, forUser, multiple = true, label = 'Attach file', className = '' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true);
    try {
      const done = [];
      for (const f of list) done.push(await uploadFile(f, forUser));
      onAdd(done);
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <>
      <input ref={ref} type="file" multiple={multiple} hidden onChange={pick} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip" />
      <button type="button" className={className} disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : `📎 ${label}`}</button>
    </>
  );
}

/** "Are you sure?" pop-up. ask = { title, text, confirm, danger, run } */
export function ConfirmDialog({ ask, onClose }) {
  const [busy, setBusy] = useState(false);
  if (!ask) return null;
  const go = async () => {
    setBusy(true);
    try {
      await ask.run();
      onClose();
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };
  // drawn at the end of <body>, so a parent card (glass blur) can never cut it off
  return createPortal(
    <div role="dialog" aria-modal="true" style={cd.overlay} onClick={() => !busy && onClose()}>
      <div style={cd.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 18 }}>{ask.title}</h3>
        {ask.text && <p style={{ margin: '8px 0 0', color: '#475569', fontSize: 14, lineHeight: 1.5 }}>{ask.text}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" style={cd.cancel} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" style={ask.danger ? cd.danger : cd.ok} disabled={busy} onClick={go} autoFocus>{busy ? 'Please wait…' : ask.confirm || 'Yes'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
const cd = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(14,42,51,.35)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { background: '#fff', borderRadius: 18, padding: 22, width: 420, maxWidth: '100%', boxShadow: '0 20px 60px rgba(30,41,99,.25)', color: '#0e2a33' },
  cancel: { border: '1px solid rgba(148,163,184,.4)', background: '#fff', color: '#334155', borderRadius: 11, padding: '9px 16px', fontWeight: 600, cursor: 'pointer' },
  ok: { border: 0, background: 'linear-gradient(150deg, #4fcde7, #1aa9c8)', color: '#fff', borderRadius: 11, padding: '9px 16px', fontWeight: 600, cursor: 'pointer' },
  danger: { border: 0, background: '#e11d48', color: '#fff', borderRadius: 11, padding: '9px 16px', fontWeight: 600, cursor: 'pointer' },
};

/** printable salary slip (Print -> Save as PDF) */
export function PayslipView({ slip, company, onClose }) {
  const row = (label, value) => (
    <tr><td style={ps.td}>{label}</td><td style={{ ...ps.td, textAlign: 'right' }}>{value}</td></tr>
  );
  return createPortal(
    <div className="payslip-overlay" style={ps.overlay} onClick={onClose}>
      <style>{`@media print { body * { visibility: hidden !important; } .payslip-print, .payslip-print * { visibility: visible !important; } .payslip-print { position: absolute; inset: 0; margin: 0; box-shadow: none !important; } .payslip-noprint { display: none !important; } }`}</style>
      <div className="payslip-print" style={ps.paper} onClick={(e) => e.stopPropagation()}>
        <div style={ps.head}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{company?.name || 'Geek Creative Agency'}</div>
            {company?.address && <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap' }}>{company.address}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Salary slip</div>
            <div style={{ fontSize: 13, color: '#475569' }}>{monthLabel(slip.month)}</div>
          </div>
        </div>
        <table style={ps.table}>
          <tbody>
            <tr><td style={ps.k}>Employee</td><td style={ps.v}>{slip.name}</td><td style={ps.k}>Employee ID</td><td style={ps.v}>{slip.code || '—'}</td></tr>
            <tr><td style={ps.k}>Designation</td><td style={ps.v}>{slip.designation || '—'}</td><td style={ps.k}>Department</td><td style={ps.v}>{slip.department || '—'}</td></tr>
            <tr><td style={ps.k}>PAN</td><td style={ps.v}>{slip.pan || '—'}</td><td style={ps.k}>Bank</td><td style={ps.v}>{slip.bank || '—'}</td></tr>
            <tr><td style={ps.k}>Days in month</td><td style={ps.v}>{slip.daysInMonth}</td><td style={ps.k}>Paid days</td><td style={ps.v}>{slip.paidDays}</td></tr>
            <tr><td style={ps.k}>Present</td><td style={ps.v}>{slip.present}</td><td style={ps.k}>Paid leave / Unpaid days</td><td style={ps.v}>{slip.paidLeave} / {slip.unpaidDays}</td></tr>
          </tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
          <table style={ps.table}>
            <thead><tr><th style={ps.th}>Earnings</th><th style={{ ...ps.th, textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {row('Basic', rupees(slip.basic))}
              {row('HRA', rupees(slip.hra))}
              {row('Allowances', rupees(slip.allowances))}
              <tr><td style={ps.tot}>Gross earnings</td><td style={{ ...ps.tot, textAlign: 'right' }}>{rupees(slip.gross)}</td></tr>
            </tbody>
          </table>
          <table style={ps.table}>
            <thead><tr><th style={ps.th}>Deductions</th><th style={{ ...ps.th, textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {row(`Loss of pay (${slip.unpaidDays} day${slip.unpaidDays === 1 ? '' : 's'})`, rupees(slip.lossOfPay))}
              {row('Professional tax', rupees(slip.pt))}
              {row('TDS', rupees(slip.tds))}
              {row('Other deductions', rupees(slip.otherDeductions))}
              <tr><td style={ps.tot}>Total deductions</td><td style={{ ...ps.tot, textAlign: 'right' }}>{rupees(slip.totalDeductions)}</td></tr>
            </tbody>
          </table>
        </div>
        <div style={ps.net}><span>Net pay</span><b>{rupees(slip.net)}</b></div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 10 }}>
          {slip.status === 'paid' ? `Paid on ${fullDay(slip.paidOn)}. ` : ''}This is a computer-generated salary slip and does not need a signature.
        </div>
        <div className="payslip-noprint" style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => window.print()} style={ps.btn}>Print / Save as PDF</button>
          <button type="button" onClick={onClose} style={{ ...ps.btn, background: '#fff', color: '#0b87a5' }}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const ps = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(14,42,51,.35)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '30px 12px' },
  paper: { background: '#fff', color: '#0f172a', width: 760, maxWidth: '100%', borderRadius: 14, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,.25)', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  head: { display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '2px solid #0b87a5', paddingBottom: 12, marginBottom: 14 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  k: { padding: '6px 8px', color: '#64748b', borderBottom: '1px solid #e2e8f0', width: '20%' },
  v: { padding: '6px 8px', fontWeight: 600, borderBottom: '1px solid #e2e8f0', width: '30%' },
  th: { textAlign: 'left', padding: '8px', background: '#effafc', color: '#0b87a5', fontSize: 12.5 },
  td: { padding: '7px 8px', borderBottom: '1px solid #e2e8f0' },
  tot: { padding: '8px', fontWeight: 700, borderTop: '2px solid #cbd5e1' },
  net: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', borderRadius: 12, background: '#0b87a5', color: '#fff', fontSize: 16 },
  btn: { border: '1px solid #0b87a5', background: '#0b87a5', color: '#fff', borderRadius: 10, padding: '9px 14px', fontWeight: 600, cursor: 'pointer' },
};
