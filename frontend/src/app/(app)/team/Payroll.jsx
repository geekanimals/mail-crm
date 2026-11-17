'use client';
// Holidays and payroll (admin side).
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuPlus, LuTrash2 } from 'react-icons/lu';
import { api, notify } from '@/lib/api';
import { PayslipView, dayLabel, monthLabel, rupees, shiftMonth, thisMonth, todayStr } from '@/lib/hr';

/* ---------------- holidays ---------------- */
export function Holidays() {
  const [year, setYear] = useState(+todayStr().slice(0, 4));
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ day: '', name: '' });
  const load = useCallback(() => api('/api/hr/holidays', { query: { year } }).then(setList).catch((e) => notify(e.message, 'error')), [year]);
  useEffect(() => {
    load();
  }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/hr/holidays', { method: 'POST', body: form });
      setForm({ day: '', name: '' });
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const remove = (h) => window.confirm(`Delete ${h.name}?`) && api(`/api/hr/holidays/${h._id}`, { method: 'DELETE' }).then(load).catch((e) => notify(e.message, 'error'));
  return (
    <div className="card">
      <div className="row hr-between">
        <div className="row">
          <button className="btn ghost sm" onClick={() => setYear(year - 1)}><LuChevronLeft /></button>
          <b>Holidays {year}</b>
          <button className="btn ghost sm" onClick={() => setYear(year + 1)}><LuChevronRight /></button>
        </div>
        {list && <span className="muted small">{list.length} holiday{list.length === 1 ? '' : 's'}</span>}
      </div>
      <p className="muted small">Holidays are not working days: nobody is marked absent and leave is not counted on them. Sunday is the weekly off.</p>
      <form className="row hr-addrow" onSubmit={add}>
        <input type="date" required value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
        <input required placeholder="Holiday name, e.g. Diwali" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <button className="btn sm"><LuPlus /> Add</button>
      </form>
      {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="empty">No holidays added for {year}.</p> : list.map((h) => (
        <div key={h._id} className="hr-item"><div><b>{h.name}</b><small>{dayLabel(h.day)}</small></div><button className="btn ghost sm tm-del" onClick={() => remove(h)}><LuTrash2 /></button></div>
      ))}
    </div>
  );
}

/* ---------------- payroll ---------------- */
export function Payroll() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [company, setCompany] = useState(null);
  const [view, setView] = useState(null);
  const [edits, setEdits] = useState({}); // this month's tds / pt per person
  const load = useCallback(() => api('/api/hr/payroll', { query: { month } }).then((d) => { setData(d); setEdits({}); }).catch((e) => notify(e.message, 'error')), [month]);
  useEffect(() => {
    load();
    api('/api/hr/company').then(setCompany).catch(() => {});
  }, [load]);

  const make = async (p, status) => {
    try {
      await api(`/api/hr/payroll/${p._id}/${month}`, { method: 'POST', body: { ...(edits[p._id] || {}), status } });
      notify(status === 'final' ? 'Slip ready - the employee can see it now' : 'Draft saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const setStatus = async (s, status) => {
    if (status === 'paid' && !window.confirm(`Mark ${s.name}'s salary for ${monthLabel(month)} as paid? A paid slip cannot be changed.`)) return;
    try {
      await api(`/api/hr/payroll/slip/${s._id}`, { method: 'PUT', body: { status } });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete this slip? You can make it again.`)) return;
    api(`/api/hr/payroll/slip/${s._id}`, { method: 'DELETE' }).then(load).catch((e) => notify(e.message, 'error'));
  };
  const saveCompany = async (e) => {
    e.preventDefault();
    try {
      setCompany(await api('/api/hr/company', { method: 'PUT', body: company }));
      notify('Saved');
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const setEdit = (idv, k, v) => setEdits({ ...edits, [idv]: { ...(edits[idv] || {}), [k]: v } });
  const total = (data?.people || []).reduce((n, p) => n + (p.slip ? p.slip.net : p.calc.net), 0);

  return (
    <>
      <div className="card">
        <div className="row hr-between">
          <div className="row">
            <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}><LuChevronLeft /></button>
            <b>Payroll · {monthLabel(month)}</b>
            <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}><LuChevronRight /></button>
          </div>
          {data && <span className="muted small">Total net pay {rupees(total)}</span>}
        </div>
        <p className="muted small">
          Salary per day = monthly gross ÷ days in the month. Absent days, unpaid leave and days before joining are cut as loss of pay.
          {month === thisMonth() ? ' This month is not over yet: the rest of the month is counted as paid for now.' : ''}
          {' '}Change PT / TDS for this month only in the boxes, then save. “Finalise” shows the slip to the employee.
        </p>
        {!data ? <p className="muted">Loading…</p> : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Employee</th><th>Paid / unpaid days</th><th>Gross</th><th>Loss of pay</th><th>PT</th><th>TDS</th><th>Net</th><th>Slip</th></tr></thead>
              <tbody>
                {data.people.map((p) => {
                  const s = p.slip;
                  const c = s || p.calc;
                  const locked = s?.status === 'paid';
                  return (
                    <tr key={`${p._id}-${month}-${s?.updatedAt || ''}`}>
                      <td><b>{p.name}</b><small className="tm-sub">{[p.code, p.title].filter(Boolean).join(' · ')}</small></td>
                      <td data-label="Days">{c.paidDays} / {c.unpaidDays}<small className="tm-sub">Present {c.present} · Leave {c.paidLeave}</small></td>
                      <td data-label="Gross">{rupees(c.gross)}</td>
                      <td data-label="Loss of pay">{rupees(c.lossOfPay)}</td>
                      <td data-label="PT">{locked ? rupees(c.pt) : <input className="hr-num" type="number" min="0" defaultValue={c.pt} onChange={(e) => setEdit(p._id, 'pt', e.target.value)} />}</td>
                      <td data-label="TDS">{locked ? rupees(c.tds) : <input className="hr-num" type="number" min="0" defaultValue={c.tds} onChange={(e) => setEdit(p._id, 'tds', e.target.value)} />}</td>
                      <td data-label="Net"><b>{rupees(c.net)}</b>{s && edits[p._id] ? <small className="tm-sub">Save to update</small> : null}</td>
                      <td data-label="Slip">
                        <div className="row tm-actions">
                          {s && <span className={`badge ${s.status === 'paid' ? 'replied' : s.status === 'final' ? 'active' : ''}`}>{s.status}</span>}
                          {!locked && <button className="btn ghost sm" onClick={() => make(p, s?.status === 'final' ? 'final' : 'draft')}>{s ? 'Update' : 'Save draft'}</button>}
                          {!locked && s?.status !== 'final' && <button className="btn ghost sm" onClick={() => make(p, 'final')}>Finalise</button>}
                          {s?.status === 'final' && <button className="btn ghost sm" onClick={() => setStatus(s, 'paid')}>Mark paid</button>}
                          {s && <button className="btn ghost sm" onClick={() => api(`/api/hr/payroll/slip/${s._id}`).then(setView).catch((e) => notify(e.message, 'error'))}>View</button>}
                          {s && !locked && <button className="btn ghost sm tm-del" onClick={() => remove(s)}><LuTrash2 /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {company && (
        <form className="card hr-grid" onSubmit={saveCompany}>
          <label className="field">Company name on slips<input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
          <label className="field hr-wide">Company address on slips<textarea rows={2} value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></label>
          <div className="row hr-wide"><button className="btn ghost sm">Save company details</button></div>
        </form>
      )}
      {view && <PayslipView slip={view} company={view.company} onClose={() => setView(null)} />}
    </>
  );
}
