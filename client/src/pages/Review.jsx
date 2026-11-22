// US-INT-001..005 — mobile-first specialist review. No login, no app install.
// DEC-016: age/gender only. DEC-056: 4-Box Opinion, Decision Chips, Voice Notes & Then-vs-Now diffing.
import { useEffect, useState, useRef } from 'react';
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

  // 4-Box Opinion Schema
  const [clinicalFindings, setClinicalFindings] = useState('');
  const [diagnosticAssessment, setDiagnosticAssessment] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [followUpGuidance, setFollowUpGuidance] = useState('');

  // Decision Chips
  const [chips, setChips] = useState({
    agreement: 'agrees_with_preliminary',
    path: 'medical_therapy',
    urgency: 'routine'
  });

  // Voice Note State
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [voicePath, setVoicePath] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [state, setState] = useState({ err: '', ok: '' });
  const [done, setDone] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/review/${token}`)
      .then(r => {
        const d = r.data;
        setData(d);
        if (d.clinical_findings) setClinicalFindings(d.clinical_findings);
        else if (d.draft?.findings) setClinicalFindings(d.draft.findings);

        if (d.diagnostic_assessment) setDiagnosticAssessment(d.diagnostic_assessment);
        else if (d.draft?.diagnostic_assessment) setDiagnosticAssessment(d.draft.diagnostic_assessment);

        if (d.recommendations) setRecommendations(d.recommendations);
        else if (d.draft?.recommendation) setRecommendations(d.draft.recommendation);

        if (d.follow_up_guidance) setFollowUpGuidance(d.follow_up_guidance);
        else if (d.draft?.follow_up_guidance) setFollowUpGuidance(d.draft.follow_up_guidance);

        if (d.decision_chips && Object.keys(d.decision_chips).length) setChips(d.decision_chips);
        else if (d.draft?.decision_chips && Object.keys(d.draft.decision_chips).length) setChips(d.draft.decision_chips);

        if (d.voice_note_path) setVoicePath(d.voice_note_path);
        else if (d.draft?.voice_note_path) setVoicePath(d.draft.voice_note_path);

        if (d.submitted) setDone(true);
      })
      .catch(e => setError(e.response?.status === 429 ? 'ratelimited' : (e.response?.data?.error || 'invalid')))
      .finally(() => setLoading(false));
  }, [token]);

  // Voice Recording handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const localUrl = URL.createObjectURL(audioBlob);
        setAudioUrl(localUrl);

        // Upload to server
        const fd = new FormData();
        fd.append('audio', audioBlob, 'dictation.webm');
        try {
          const { data } = await api.post(`/review/${token}/voice-note`, fd);
          setVoicePath(data.voice_note_path);
          setState({ ok: 'Voice note recorded and uploaded successfully', err: '' });
        } catch (err) {
          setState({ err: 'Failed to upload voice note', ok: '' });
        }
      };

      mediaRecorderRef.current.start();
      setRecording(true);
    } catch (err) {
      setState({ err: 'Microphone permission denied or not supported on this device', ok: '' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      setRecording(false);
    }
  };

  const saveDraft = async () => {
    setState({ err: '', ok: '' });
    try {
      await api.post(`/review/${token}/draft`, {
        clinical_findings: clinicalFindings,
        diagnostic_assessment: diagnosticAssessment,
        recommendations,
        follow_up_guidance: followUpGuidance,
        decision_chips: chips,
        voice_note_path: voicePath
      });
      setState({ ok: t('draftSaved'), err: '' });
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  const submit = async () => {
    setState({ err: '', ok: '' });
    const hasMinText = clinicalFindings.trim().length >= 50 && recommendations.trim().length >= 50;
    const hasVoiceWithNote = !!voicePath && clinicalFindings.trim().length >= 20;

    if (!hasMinText && !hasVoiceWithNote) {
      return setState({
        err: 'Please complete Clinical Findings and Recommendations (min 50 chars each), or attach a Voice Note (min 20 chars).',
        ok: ''
      });
    }

    if (!window.confirm(t('confirmSubmit'))) return;
    setBusy(true);

    try {
      await api.post(`/review/${token}/submit`, {
        clinical_findings: clinicalFindings.trim(),
        diagnostic_assessment: diagnosticAssessment.trim(),
        recommendations: recommendations.trim(),
        follow_up_guidance: followUpGuidance.trim(),
        decision_chips: chips,
        voice_note_path: voicePath
      });
      setDone(true);
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    } finally {
      setBusy(false);
    }
  };

  const requestInfo = async () => {
    setState({ err: '', ok: '' });
    try {
      await api.post(`/review/${token}/request-info`, { message: infoMsg });
      setState({ ok: 'Information request sent to coordination team.', err: '' });
      setShowInfo(false);
      setInfoMsg('');
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12 }}>
      <strong style={{ letterSpacing: 2 }}>{t('app')} · SPECIALIST REVIEW</strong>
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
      <h1>{data.case_number} {data.round_number > 1 && <span className="badge">Round {data.round_number}</span>}</h1>
      <p className="muted">
        {t('specialty')}: <strong>{data.specialty || '—'}</strong> · {t('purpose')}: {data.purpose || '—'} · {t('expires')}: {fmtDate(data.expires_at)}
      </p>
      <p>{t('age')}: {data.patient_age ?? '—'} · {t('gender')}: {data.patient_gender === 'FEMALE' ? t('female') : data.patient_gender === 'MALE' ? t('male') : '—'}</p>

      {/* Case Details */}
      <section className="box">
        <h2>{t('reason')}</h2>
        <p>{data.reason}</p>
        {data.request_note && (
          <div style={{ background: '#f5f5f5', border: '1px solid #000', padding: 8, margin: '8px 0' }}>
            <strong>Coordinator Dispatch Note:</strong> {data.request_note}
          </div>
        )}
        {data.history && Object.keys(data.history).length > 0 && (
          <p className="muted">
            {t('symptoms')}: {data.history.symptoms || '—'} · {t('diagnosis')}: {data.history.diagnosis || '—'} · {t('medications')}: {data.history.medications || '—'} · {t('allergies')}: {data.history.allergies || '—'}
          </p>
        )}
      </section>

      {/* Multi-Round Then vs Now Diffing Viewer */}
      {data.previous_rounds && data.previous_rounds.length > 0 && (
        <section className="box">
          <h2>{t('thenVsNow')} ({data.previous_rounds.length} previous round(s))</h2>
          {data.previous_rounds.map(pr => (
            <details key={pr.id} style={{ margin: '8px 0' }}>
              <summary>
                Round {pr.round_number} ({pr.request_type}) — by {pr.specialist_name} ({fmtDate(pr.submitted_at)})
              </summary>
              <div className="inner">
                <p><strong>Decision:</strong> {pr.decision_chips?.agreement} · {pr.decision_chips?.path} · {pr.decision_chips?.urgency}</p>
                <p><strong>Findings:</strong> {pr.clinical_findings}</p>
                <p><strong>Recommendations:</strong> {pr.recommendations}</p>
                {pr.follow_up_guidance && <p><strong>Follow-Up:</strong> {pr.follow_up_guidance}</p>}
              </div>
            </details>
          ))}
        </section>
      )}

      {/* Documents */}
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

      {/* Specialist Opinion Desk */}
      <section className="box">
        <h2>{t('submitOpinion')}</h2>
        {data.draft && <p className="muted">[{t('draftLabel')}]</p>}
        <Msg err={state.err} ok={state.ok} />

        {/* 1. Decision Chips */}
        <div style={{ margin: '14px 0', border: '1px solid #000', padding: 12 }}>
          <strong>1. {t('decisionChips')}</strong>
          <div className="grid2" style={{ marginTop: 8, gap: 12 }}>
            <div>
              <label style={{ fontSize: 12 }}>Clinical Agreement:</label>
              <select value={chips.agreement} onChange={e => setChips({ ...chips, agreement: e.target.value })}>
                <option value="agrees_with_preliminary">Agrees with Preliminary Plan</option>
                <option value="modifies_preliminary">Modifies Proposed Plan</option>
                <option value="disagrees">Disagrees / Recommends Alternative</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Suggested Path:</label>
              <select value={chips.path} onChange={e => setChips({ ...chips, path: e.target.value })}>
                <option value="medical_therapy">Medical Therapy</option>
                <option value="interventional">Interventional</option>
                <option value="surgical">Surgical</option>
                <option value="further_investigation">Further Investigation</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12 }}>Urgency Level:</label>
              <select value={chips.urgency} onChange={e => setChips({ ...chips, urgency: e.target.value })}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergent">Emergent</option>
              </select>
            </div>
          </div>
        </div>

        {/* 2. 4-Box Opinion Schema */}
        <Field label={`2. ${t('clinicalFindings')} (min 50 chars)`}>
          <textarea
            value={clinicalFindings}
            onChange={e => setClinicalFindings(e.target.value)}
            placeholder="Key observations from imaging, labs, and clinical records..."
          />
        </Field>
        <p className="muted">{clinicalFindings.trim().length}/50</p>

        <Field label={`3. ${t('diagnosticAssessment')}`}>
          <textarea
            value={diagnosticAssessment}
            onChange={e => setDiagnosticAssessment(e.target.value)}
            placeholder="Primary diagnosis, disease staging, and differentials..."
            style={{ minHeight: 70 }}
          />
        </Field>

        <Field label={`4. ${t('recommendations')} (min 50 chars)`}>
          <textarea
            value={recommendations}
            onChange={e => setRecommendations(e.target.value)}
            placeholder="Detailed actionable management recommendations..."
          />
        </Field>
        <p className="muted">{recommendations.trim().length}/50</p>

        <Field label={`5. ${t('followUpGuidance')}`}>
          <textarea
            value={followUpGuidance}
            onChange={e => setFollowUpGuidance(e.target.value)}
            placeholder="Recommended follow-up interval and monitoring parameters..."
            style={{ minHeight: 70 }}
          />
        </Field>

        {/* 3. Mobile Voice Dictation Recorder */}
        <div style={{ margin: '16px 0', border: '1px solid #000', padding: 12 }}>
          <strong>🎙 {t('voiceDictation')}</strong>
          <p className="muted" style={{ margin: '4px 0 10px' }}>
            Record an audio summary for the patient and coordinator (optional).
          </p>
          <div className="row">
            {!recording ? (
              <button type="button" onClick={startRecording}>
                ⏺ {t('startRecord')}
              </button>
            ) : (
              <button type="button" onClick={stopRecording} style={{ background: '#000', color: '#fff' }}>
                ⏹ {t('stopRecord')} (Recording...)
              </button>
            )}
            {voicePath && <span className="badge">✓ {t('voiceAttached')}</span>}
          </div>
          {audioUrl && (
            <div style={{ marginTop: 10 }}>
              <audio controls src={audioUrl} style={{ width: '100%', height: 40 }} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="row" style={{ marginTop: 20 }}>
          <button onClick={saveDraft}>{t('saveDraft')}</button>
          <button onClick={submit} disabled={busy}>{busy ? t('loading') : t('submitOpinion')}</button>
          <button onClick={() => setShowInfo(!showInfo)}>{t('requestInfo')}</button>
        </div>

        {showInfo && (
          <div style={{ marginTop: 12, borderTop: '1px solid #ccc', paddingTop: 8 }}>
            <textarea
              value={infoMsg}
              onChange={e => setInfoMsg(e.target.value)}
              placeholder="Describe which specific medical records or clarification are required..."
            />
            <button onClick={requestInfo} disabled={!infoMsg.trim()} style={{ marginTop: 6 }}>
              {t('submit')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
