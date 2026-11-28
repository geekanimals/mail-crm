'use client';
// Settings → Agreements & estimates: the agreement template, its default values, who signs for Geek,
// Geek's details and bank account on the estimate, the estimate terms and the advance %.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { api, notify } from '@/lib/api';
import { Toolbar } from '@/components/ClientDocs';
import { ConfirmDialog } from '@/lib/hr';

const DEFAULT_FIELDS = [
  ['creators', 'Creator slots'],
  ['guarantee', 'Minimum guarantee'],
  ['paymentTerms', 'Payment terms'],
  ['nonBarterPayout', 'Non-barter payout per creator (₹)'],
  ['logisticsFee', 'Logistics fee'],
  ['carryMonths', 'Carry-forward (months)'],
  ['nonCircMonths', 'Non-circumvention (months)'],
  ['jurisdiction', 'Courts at'],
];
const PLACEHOLDERS = 'effective_date, client_name, brand, creators, max_profiles, guarantee, fee, payment_terms, nonbarter_payout, logistics_fee, carry_months, noncirc_months, jurisdiction, annex_creators, annex_payment, annex_eligibility, annex_consideration, annex_deliverables, annex_timelines, annex_approval';

const Editor = memo(
  function Editor({ initial, onChange }) {
    return <div className="cd-doc editable ds-doc" contentEditable suppressContentEditableWarning onInput={(e) => onChange(e.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: initial }} />;
  },
  (a, b) => a.initial === b.initial
);

export default function DocSettings() {
  const [s, setS] = useState(null);
  const [init, setInit] = useState('');
  const [key, setKey] = useState(0);
  const [ask, setAsk] = useState(null);
  const tpl = useRef('');
  const load = useCallback(
    () =>
      api('/api/documents/settings/all')
        .then((r) => {
          setS({ ...r, estimateTermsText: (r.estimateTerms || []).join('\n') });
          tpl.current = r.agreementTemplate;
          setInit(r.agreementTemplate);
          setKey((k) => k + 1);
        })
        .catch(() => {}),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!s) return null;
  const save = async () => {
    try {
      await api('/api/documents/settings/all', {
        method: 'PUT',
        body: { agreementTemplate: tpl.current, agreementFields: s.agreementFields, signatory: s.signatory, geek: s.geek, bank: s.bank, estimateTerms: s.estimateTermsText.split('\n'), advancePercent: s.advancePercent },
      });
      notify('Saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const set = (k, v) => setS({ ...s, [k]: v });
  return (
    <div className="card ds">
      <style>{css}</style>
      <h2>Agreements and estimates</h2>
      <p className="muted small">Used on an Opportunity’s company page: agreement → estimate → advance payment → account. Changes here apply to new documents; documents already made keep their text.</p>

      <h3>Agreement template</h3>
      <p className="muted small">Edit it like a document. Words in double curly brackets are filled from the campaign: {PLACEHOLDERS}. Keep the line “[Signatures]” where the signature block goes.</p>
      <Toolbar />
      <Editor key={key} initial={init} onChange={(h) => (tpl.current = h)} />
      <button
        className="btn ghost sm"
        onClick={() =>
          setAsk({
            title: 'Put back the original template?',
            text: 'The template goes back to the Barter Agreement text the CRM started with. Save afterwards to keep it.',
            confirm: 'Yes, put it back',
            danger: true,
            run: async () => {
              tpl.current = s.defaults.agreementTemplate;
              setInit(s.defaults.agreementTemplate);
              setKey((k) => k + 1);
            },
          })
        }
      >
        Original template
      </button>

      <h3>Values filled in for every new agreement</h3>
      <div className="ds-grid">
        {DEFAULT_FIELDS.map(([k, l]) => <label key={k} className="field">{l}<input value={s.agreementFields?.[k] || ''} onChange={(e) => set('agreementFields', { ...s.agreementFields, [k]: e.target.value })} /></label>)}
        <label className="field">Signs for Geek (name)<input value={s.signatory?.name || ''} onChange={(e) => set('signatory', { ...s.signatory, name: e.target.value })} /></label>
        <label className="field">Designation<input value={s.signatory?.designation || ''} onChange={(e) => set('signatory', { ...s.signatory, designation: e.target.value })} /></label>
      </div>

      <h3>Estimate</h3>
      <p className="muted small">Next number: <b>{s.nextEstimateNumber}</b> (one series per financial year; a new series starts each April).</p>
      <div className="ds-grid">
        <label className="field">Company name<input value={s.geek?.name || ''} onChange={(e) => set('geek', { ...s.geek, name: e.target.value })} /></label>
        <label className="field">GSTIN<input value={s.geek?.gstin || ''} onChange={(e) => set('geek', { ...s.geek, gstin: e.target.value })} /></label>
        <label className="field">HSN / SAC code<input value={s.geek?.hsn || ''} onChange={(e) => set('geek', { ...s.geek, hsn: e.target.value })} /></label>
        <label className="field">PAN<input value={s.geek?.pan || ''} onChange={(e) => set('geek', { ...s.geek, pan: e.target.value })} /></label>
        <label className="field ds-wide">Address<textarea rows={3} value={s.geek?.address || ''} onChange={(e) => set('geek', { ...s.geek, address: e.target.value })} /></label>
        <label className="field ds-wide">Bank details<textarea rows={4} value={s.bank || ''} onChange={(e) => set('bank', e.target.value)} /></label>
        <label className="field ds-wide">Terms & Conditions (one per line)<textarea rows={3} value={s.estimateTermsText} onChange={(e) => set('estimateTermsText', e.target.value)} /></label>
        <label className="field">Advance before the account (%)<input type="number" min={1} max={100} value={s.advancePercent} onChange={(e) => set('advancePercent', e.target.value)} /></label>
      </div>
      <p className="muted small">The Director’s signature and the Geek logo are printed on every estimate and agreement.</p>
      <button className="btn sm" onClick={save}>Save</button>
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

const css = `
.ds h3 { margin: 16px 0 6px; font-size: 15px; }
.ds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin-bottom: 8px; }
.ds-wide { grid-column: 1 / -1; }
.ds textarea { font-family: inherit; line-height: 1.5; }
.ds-doc { max-height: 420px; margin-bottom: 8px; }
.ds .cd-toolbar { display: flex; gap: 4px; margin-bottom: 6px; }
.ds .cd-toolbar button { border: 1px solid rgba(148,163,184,.4); background: #fff; border-radius: 8px; width: 32px; height: 30px; display: grid; place-items: center; cursor: pointer; font-weight: 700; color: #334155; }
.ds .cd-doc { border: 1px solid rgba(148,163,184,.35); border-radius: 12px; padding: 24px 30px; overflow-y: auto; font-family: Arial, Helvetica, sans-serif; font-size: 13.5px; line-height: 1.6; color: #1f2328; background: #fff; outline: none; }
.ds .cd-doc:focus { box-shadow: 0 0 0 3px rgba(26,169,200,.25); }
.ds .cd-doc h1 { text-align: center; font-size: 20px; margin: 0 0 12px; }
.ds .cd-doc h2 { font-size: 15px; margin: 14px 0 6px; }
.ds .cd-doc p { margin: 0 0 10px; }
`;
