// DEC-056: ALO Platform Coordinator — International Second Opinions Queue (Bridge 2)
import { useState, useEffect } from 'react';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, Field } from '../../components/ui';

export default function IntlOpinionsQueue() {
  const { t } = useI18n();
  const [opinions, setOpinions] = useState([]);
  const [specialists, setSpecialists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // Dispatch modal
  const [selectedReq, setSelectedReq] = useState(null);
  const [dispForm, setDispForm] = useState({ specialist_id: '', specialist_name: '', specialist_phone: '' });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setErr('');
    try {
      const [opRes, spRes] = await Promise.all([
        api.get('/staff/intl-opinions'),
        api.get('/staff/intl-specialists').catch(() => ({ data: { specialists: [] } }))
      ]);
      setOpinions(opRes.data.opinions || []);
      setSpecialists(spRes.data.specialists || []);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const onSpecialistSelect = (specId) => {
    const spec = specialists.find(s => s.id === specId);
    if (spec) {
      setDispForm({
        specialist_id: spec.id,
        specialist_name: spec.full_name,
        specialist_phone: spec.phone_e164 || ''
      });
    } else {
      setDispForm({ specialist_id: '', specialist_name: '', specialist_phone: '' });
    }
  };

  const dispatchToSpecialist = async (e) => {
    e?.preventDefault();
    if (!selectedReq || !dispForm.specialist_name || !dispForm.specialist_phone) return;
    setBusy(true); setErr(''); setOk('');

    try {
      const { data } = await api.post(`/staff/intl-opinions/${selectedReq.id}/dispatch`, dispForm);
      setOk(`Dispatched to Dr. ${dispForm.specialist_name}! Magic link sent: ${data.review_url}`);
      setSelectedReq(null);
      setDispForm({ specialist_id: '', specialist_name: '', specialist_phone: '' });
      reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 10 }}>
        <div>
          <h1 style={{ margin: 0, border: 'none', padding: 0 }}>International Second Opinions Queue</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Bridge 2: Second opinion requests from Saudi partner hospitals</p>
        </div>
        <button onClick={reload}>{t('refresh')}</button>
      </div>

      <Msg err={err} ok={ok} />

      <section className="box" style={{ marginTop: 16 }}>
        <h2>Active Opinion Requests ({opinions.length})</h2>
        {!opinions.length && <p className="muted">{t('noItems')}</p>}
        <table>
          <thead>
            <tr><th>Hospital</th><th>Specialty</th><th>Clinical Question</th><th>SLA Due</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {opinions.map(o => (
              <tr key={o.id}>
                <td><strong>{o.hospitals?.name}</strong> ({o.hospitals?.city})</td>
                <td>{o.specialty}</td>
                <td style={{ maxWidth: 300 }}>
                  <div style={{ maxHeight: 60, overflowY: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.clinical_question}
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>Doctor: {o.staff_users?.full_name}</span>
                </td>
                <td><span className="badge">{fmtDate(o.due_at)}</span></td>
                <td><span className="badge">{o.status}</span></td>
                <td>
                  {o.status === 'requested' ? (
                    <button onClick={() => { setSelectedReq(o); onSpecialistSelect(''); }}>
                      Dispatch to Specialist
                    </button>
                  ) : (
                    <span className="muted">
                      {o.status === 'submitted' ? '✓ Completed' : 'Pending Review'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Dispatch Modal */}
      {selectedReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="box" style={{ background: '#fff', maxWidth: 600, width: '90%' }}>
            <h2>Dispatch to Global Specialist</h2>
            <p className="muted">
              Hospital: <strong>{selectedReq.hospitals?.name}</strong> · Specialty: <strong>{selectedReq.specialty}</strong>
            </p>

            <form onSubmit={dispatchToSpecialist}>
              <Field label="Select from Specialist Directory">
                <select value={dispForm.specialist_id} onChange={e => onSpecialistSelect(e.target.value)}>
                  <option value="">-- Or enter custom specialist below --</option>
                  {specialists.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.specialty} - {s.institution || s.country})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Specialist Full Name">
                <input
                  required
                  value={dispForm.specialist_name}
                  onChange={e => setDispForm({ ...dispForm, specialist_name: e.target.value })}
                  placeholder="e.g. Dr. David Nunez"
                />
              </Field>

              <Field label="Specialist WhatsApp Phone (+CountryCode...)">
                <input
                  required
                  value={dispForm.specialist_phone}
                  onChange={e => setDispForm({ ...dispForm, specialist_phone: e.target.value })}
                  placeholder="e.g. +12165550199"
                />
              </Field>

              <div className="row" style={{ marginTop: 16 }}>
                <button type="submit" disabled={busy || !dispForm.specialist_name || !dispForm.specialist_phone}>
                  {busy ? t('loading') : 'Generate Magic Link & Send WhatsApp'}
                </button>
                <button type="button" onClick={() => setSelectedReq(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
