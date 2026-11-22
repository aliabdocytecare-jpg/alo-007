// DEC-056: International Specialist Second Opinion Review (/review/intl/:token)
// Privacy-minimized: Age/Gender + Clinical Question + Scans (zero patient phone or names)
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, DocPreview } from '../../components/ui';

export default function IntlReview() {
  const { token } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [opinionText, setOpinionText] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [chips, setChips] = useState({
    agreement: 'agrees_with_preliminary',
    path: 'medical_therapy',
    urgency: 'routine'
  });
  const [state, setState] = useState({ err: '', ok: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/review/intl/${token}`)
      .then(r => {
        setData(r.data);
        if (r.data.opinion_text) setOpinionText(r.data.opinion_text);
        if (r.data.recommendations) setRecommendations(r.data.recommendations);
        if (r.data.decision_chips && Object.keys(r.data.decision_chips).length) {
          setChips(r.data.decision_chips);
        }
        if (r.data.submitted) setDone(true);
      })
      .catch(e => setError(e.response?.status === 429 ? 'ratelimited' : (e.response?.data?.error || 'invalid')))
      .finally(() => setLoading(false));
  }, [token]);

  const submitOpinion = async () => {
    setState({ err: '', ok: '' });
    if (opinionText.trim().length < 30 || recommendations.trim().length < 30) {
      return setState({ err: 'Opinion and recommendations require minimum 30 characters each', ok: '' });
    }
    if (!window.confirm('Are you sure you want to submit your clinical second opinion? This cannot be undone.')) return;

    setBusy(true);
    try {
      await api.post(`/review/intl/${token}/submit`, {
        opinion_text: opinionText.trim(),
        recommendations: recommendations.trim(),
        decision_chips: chips
      });
      setDone(true);
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
      <strong style={{ letterSpacing: 2 }}>{t('app')} · INTERNATIONAL SPECIALIST PORTAL</strong>
      <button onClick={toggle}>{t('language')}</button>
    </div>
  );

  if (loading) return <div className="wrap" style={{ maxWidth: 800 }}>{header}<p>{t('loading')}</p></div>;

  if (error) {
    const msg = error === 'expired' ? t('linkExpired') : error === 'revoked' ? t('linkRevoked') : error === 'ratelimited' ? t('tooManyAttempts') : t('linkInvalid');
    return <div className="wrap" style={{ maxWidth: 800 }}>{header}<section className="box"><p>{msg}</p></section></div>;
  }

  if (done) {
    return (
      <div className="wrap" style={{ maxWidth: 800 }}>
        {header}
        <section className="box" style={{ textAlign: 'center', padding: 32 }}>
          <h2>{t('thankYou')}</h2>
          <p className="muted">Your consultation opinion and recommendations have been successfully appended to the Saudi hospital patient chart.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 800 }}>
      {header}
      <h1>{data.case_number} · Second Opinion Consultation</h1>
      <p className="muted">
        Hospital: <strong>{data.hospital_name}</strong> ({data.hospital_city}) · Specialty: <strong>{data.specialty}</strong> · SLA Due: {fmtDate(data.due_at || data.expires_at)}
      </p>

      {/* Privacy-Minimization Banner */}
      <div className="badge" style={{ display: 'inline-block', margin: '8px 0 16px' }}>
        Patient Profile: {data.patient_age ? `${data.patient_age} yrs` : 'Adult'} · {data.patient_gender === 'MALE' ? t('male') : data.patient_gender === 'FEMALE' ? t('female') : '—'} (Identity Anonymized)
      </div>

      <section className="box">
        <h2>Consultation Clinical Question</h2>
        <p style={{ fontSize: 16, lineHeight: 1.6 }}>{data.clinical_question}</p>
      </section>

      <section className="box">
        <h2>Hospital Attached Documents & Scans [{data.documents?.length || 0}]</h2>
        {!data.documents?.length && <p className="muted">{t('noItems')}</p>}
        {data.documents?.map(d => (
          <div key={d.id} style={{ marginBottom: 16, borderBottom: '1px solid #ccc', paddingBottom: 12 }}>
            <p><strong>{d.file_name}</strong> <span className="muted">({d.category})</span></p>
            <DocPreview url={`/api/v1/review/intl/${token}/documents/${d.id}`} doc={d} />
          </div>
        ))}
      </section>

      <section className="box">
        <h2>Specialist Opinion & Care Recommendations</h2>
        <Msg err={state.err} ok={state.ok} />

        <div style={{ margin: '16px 0' }}>
          <label><strong>1. Decision Chips</strong></label>
          <div className="row" style={{ marginTop: 6, gap: 12 }}>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Agreement:</span>
              <select value={chips.agreement} onChange={e => setChips({ ...chips, agreement: e.target.value })}>
                <option value="agrees_with_preliminary">Agrees with Preliminary Plan</option>
                <option value="modifies_preliminary">Modifies Proposed Plan</option>
                <option value="disagrees">Disagrees / Recommends Alternative</option>
              </select>
            </div>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Suggested Path:</span>
              <select value={chips.path} onChange={e => setChips({ ...chips, path: e.target.value })}>
                <option value="medical_therapy">Medical Therapy</option>
                <option value="interventional">Interventional</option>
                <option value="surgical">Surgical</option>
                <option value="further_investigation">Further Investigation</option>
              </select>
            </div>
            <div>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>Urgency:</span>
              <select value={chips.urgency} onChange={e => setChips({ ...chips, urgency: e.target.value })}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergent">Emergent</option>
              </select>
            </div>
          </div>
        </div>

        <Field label="2. Clinical Opinion / Assessment (min 30 chars)">
          <textarea
            value={opinionText}
            onChange={e => setOpinionText(e.target.value)}
            placeholder="Document your clinical evaluation and review of imaging/records..."
            style={{ minHeight: 110 }}
          />
        </Field>
        <p className="muted">{opinionText.trim().length}/30 characters</p>

        <Field label="3. Actionable Care Recommendations (min 30 chars)">
          <textarea
            value={recommendations}
            onChange={e => setRecommendations(e.target.value)}
            placeholder="Specific medical recommendations, surveillance intervals, drug adjustments, or procedures..."
            style={{ minHeight: 110 }}
          />
        </Field>
        <p className="muted">{recommendations.trim().length}/30 characters</p>

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={submitOpinion} disabled={busy || opinionText.trim().length < 30 || recommendations.trim().length < 30}>
            {busy ? t('loading') : 'Submit Second Opinion to Saudi Clinic'}
          </button>
        </div>
      </section>
    </div>
  );
}
