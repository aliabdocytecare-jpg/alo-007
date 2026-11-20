// US-INT-001..005 — mobile-first specialist review. No login, no app install.
// DEC-016: age/gender only. Expired/revoked/invalid -> friendly screen, zero case data.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg, fmtDate } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Msg, Field, DocPreview } from '../components/ui';

export default function Review() {
  const { token } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [state, setState] = useState({ err: '', ok: '' });
  const [done, setDone] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    api.get(`/review/${token}`)
      .then(r => {
        setData(r.data);
        if (r.data.draft) { setFindings(r.data.draft.findings || ''); setRecommendation(r.data.draft.recommendation || ''); }
        if (r.data.submitted) setDone(true);
      })
      .catch(e => setError(e.response?.status === 429 ? 'ratelimited' : (e.response?.data?.error || 'invalid')))
      .finally(() => setLoading(false));
  }, [token]);

  const saveDraft = async () => {
    setState({ err: '', ok: '' });
    try { await api.post(`/review/${token}/draft`, { findings, recommendation }); setState({ ok: t('draftSaved'), err: '' }); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };

  const submit = async () => {
    setState({ err: '', ok: '' });
    if (findings.trim().length < 50 || recommendation.trim().length < 50) {
      return setState({ err: `${t('findings')} + ${t('recommendation')}: min 50 chars`, ok: '' });
    }
    if (!window.confirm(t('confirmSubmit'))) return;
    try { await api.post(`/review/${token}/submit`, { findings, recommendation }); setDone(true); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };

  const requestInfo = async () => {
    setState({ err: '', ok: '' });
    try { await api.post(`/review/${token}/request-info`, { message: infoMsg }); setState({ ok: 'OK', err: '' }); setShowInfo(false); setInfoMsg(''); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12 }}>
      <strong style={{ letterSpacing: 2 }}>{t('app')}</strong>
      <button onClick={toggle}>{t('language')}</button>
    </div>
  );

  if (loading) return <div className="wrap">{header}<p>{t('loading')}</p></div>;

  if (error) {
    const msg = error === 'expired' ? t('linkExpired') : error === 'revoked' ? t('linkRevoked') : error === 'ratelimited' ? t('tooManyAttempts') : t('linkInvalid');
    return <div className="wrap">{header}<section className="box"><p>{msg}</p></section></div>;
  }

  if (done) return <div className="wrap">{header}<section className="box"><p><strong>{t('thankYou')}</strong></p></section></div>;

  return (
    <div className="wrap">
      {header}
      <h1>{data.case_number}</h1>
      <p className="muted">{t('specialty')}: {data.specialty || '—'} · {t('purpose')}: {data.purpose || '—'} · {t('expires')}: {fmtDate(data.expires_at)}</p>
      <p>{t('age')}: {data.patient_age ?? '—'} · {t('gender')}: {data.patient_gender === 'FEMALE' ? t('female') : data.patient_gender === 'MALE' ? t('male') : '—'}</p>

      <section className="box">
        <h2>{t('reason')}</h2>
        <p>{data.reason}</p>
        {data.history && Object.keys(data.history).length > 0 && (
          <p className="muted">
            {t('symptoms')}: {data.history.symptoms || '—'} · {t('diagnosis')}: {data.history.diagnosis || '—'} · {t('medications')}: {data.history.medications || '—'} · {t('allergies')}: {data.history.allergies || '—'}
          </p>
        )}
      </section>

      <section className="box">
        <h2>{t('documents')} [{data.documents.length}]</h2>
        {!data.documents.length && <p className="muted">{t('noItems')}</p>}
        {data.documents.map(d => (
          <div key={d.id} style={{ marginBottom: 12 }}>
            <p><strong>{d.file_name}</strong> <span className="muted">({d.category})</span></p>
            <DocPreview url={`/api/v1/review/${token}/documents/${d.id}`} doc={d} />
          </div>
        ))}
      </section>

      <section className="box">
        <h2>{t('submitOpinion')}</h2>
        {data.draft && <p className="muted">[{t('draftLabel')}]</p>}
        <Msg err={state.err} ok={state.ok} />
        <Field label={`${t('findings')} (min 50)`}>
          <textarea value={findings} onChange={e => setFindings(e.target.value)} />
        </Field>
        <p className="muted">{findings.trim().length}/50</p>
        <Field label={`${t('recommendation')} (min 50)`}>
          <textarea value={recommendation} onChange={e => setRecommendation(e.target.value)} />
        </Field>
        <p className="muted">{recommendation.trim().length}/50</p>
        <div className="row">
          <button onClick={saveDraft}>{t('saveDraft')}</button>
          <button onClick={submit}>{t('submitOpinion')}</button>
          <button onClick={() => setShowInfo(!showInfo)}>{t('requestInfo')}</button>
        </div>
        {showInfo && (
          <div style={{ marginTop: 8 }}>
            <textarea value={infoMsg} onChange={e => setInfoMsg(e.target.value)} placeholder={t('requestInfo')} />
            <button onClick={requestInfo} disabled={!infoMsg.trim()}>{t('submit')}</button>
          </div>
        )}
      </section>
    </div>
  );
}