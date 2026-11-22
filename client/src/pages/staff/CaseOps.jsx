// Role-aware case console: coordinator ops (US-CRD), nurse intake (US-NUR), doctor clinical (US-DOC).
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, StatusBadge, Timeline, DocumentList, FileUploader, useAsync } from '../../components/ui';

const REQUIRED_DOCS = { GMO: ['Medical Report', 'Imaging', 'Lab Result'], CONSULTATION: ['ID Document'], SERVICE: [] };

function ActionMsg({ state }) { return <Msg err={state.err} ok={state.ok} />; }
function useAction(reload) {
  const [state, setState] = useState({ err: '', ok: '' });
  const run = async (fn, okMsg = 'OK') => {
    setState({ err: '', ok: '' });
    try { await fn(); setState({ err: '', ok: okMsg }); reload(); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  return [state, run];
}

function CoordinatorPanel({ c, reload }) {
  const { t } = useI18n();
  const [state, run] = useAction(reload);
  const [directory, setDirectory] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [payNote, setPayNote] = useState('');
  const [docsNote, setDocsNote] = useState('');
  const [schedAt, setSchedAt] = useState('');
  const [clinic, setClinic] = useState({ name: '', address: '' });
  const [meet, setMeet] = useState('');
  const [spec, setSpec] = useState({ name: '', phone: '' });
  const [cancelReason, setCancelReason] = useState('');
  const [escNote, setEscNote] = useState('');

  useEffect(() => { api.get('/staff/directory').then(r => setDirectory(r.data)).catch(() => {}); }, []);

  const latestLink = c.magic_links?.[0];
  const linkState = latestLink
    ? (latestLink.submitted_at ? t('submitted') : latestLink.draft_saved_at ? t('draftSaved') : latestLink.opened_at ? t('opened') : t('sent'))
    : null;
  const reportText = c.consultation?.final_report
    || (c.review?.status === 'SUBMITTED' ? `FINDINGS:\n${c.review.findings}\n\nRECOMMENDATION:\n${c.review.recommendation}` : null);

  return (
    <section className="box">
      <h2>{t('coordinator')} — {t('actions')}</h2>
      <ActionMsg state={state} />

      {!c.payment_confirmed && ['SUBMITTED', 'INITIAL_REVIEW'].includes(c.status) && (
        <div className="row">
          <input style={{ maxWidth: 320 }} placeholder={t('paymentNote')} value={payNote} onChange={e => setPayNote(e.target.value)} />
          <button onClick={() => run(() => api.post(`/cases/${c.id}/confirm-payment`, { note: payNote }))}>{t('confirmPayment')}</button>
        </div>
      )}
      {c.payment_confirmed && <p className="muted">[{t('confirmPayment')}: ✓ {c.payment_note}]</p>}

      {['INITIAL_REVIEW', 'READY_FOR_ASSIGNMENT'].includes(c.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          <input style={{ maxWidth: 320 }} placeholder={t('docsNote')} value={docsNote} onChange={e => setDocsNote(e.target.value)} />
          <button onClick={() => run(() => api.post(`/cases/${c.id}/request-documents`, { note: docsNote }))}>{t('requestDocs')}</button>
        </div>
      )}

      {c.status === 'INITIAL_REVIEW' && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => run(() => api.patch(`/cases/${c.id}/status`, { to: 'READY_FOR_ASSIGNMENT', version: c.version }))}>{t('unassigned')} →</button>
        </div>
      )}

      {['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          <select data-testid="assign-staff" style={{ maxWidth: 320 }} value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">{t('assign')} — {t('nurse')} / {t('doctor')}</option>
            {directory.filter(s => ['nurse', 'doctor'].includes(s.role)).map(s => (
              <option key={s.id} value={s.id}>{s.full_name} ({t(s.role)}{s.specialty ? ` · ${s.specialty}` : ''})</option>
            ))}
          </select>
          <button disabled={!staffId} onClick={() => run(() => api.post(`/cases/${c.id}/assign`, { staff_id: staffId }))}>{t('assign')}</button>
        </div>
      )}

      {c.service_type === 'CONSULTATION' && c.status === 'SPECIALIST_ASSIGNED' && (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            <input style={{ maxWidth: 240 }} type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)} />
            <input style={{ maxWidth: 200 }} placeholder={t('clinicName')} value={clinic.name} onChange={e => setClinic({ ...clinic, name: e.target.value })} />
            <input style={{ maxWidth: 240 }} placeholder={t('clinicAddress')} value={clinic.address} onChange={e => setClinic({ ...clinic, address: e.target.value })} />
            <button disabled={!schedAt} onClick={() => run(() => api.post(`/cases/${c.id}/schedule`, { scheduled_at: new Date(schedAt).toISOString(), clinic_name: clinic.name, clinic_address: clinic.address }))}>{t('schedule')}</button>
          </div>
        </div>
      )}

      {c.consultation && (
        <div className="row" style={{ marginTop: 8 }}>
          <input style={{ maxWidth: 360 }} placeholder="https://meet.google.com/xxx-xxxx-xxx" value={meet} onChange={e => setMeet(e.target.value)} dir="ltr" />
          <button onClick={() => run(() => api.patch(`/cases/${c.id}/meet-link`, { meet_url: meet }))}>{t('meetLink')}</button>
          {c.consultation.meet_url && <span className="muted">{c.consultation.meet_url}</span>}
        </div>
      )}

      {c.service_type === 'GMO' && ['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div style={{ marginTop: 8 }}>
          <h3>{t('assignSpecialist')} (Multi-Round Review)</h3>
          <div className="row">
            <input style={{ maxWidth: 200 }} placeholder={t('specialistName')} value={spec.name} onChange={e => setSpec({ ...spec, name: e.target.value })} />
            <input style={{ maxWidth: 180 }} placeholder="+91XXXXXXXXXX" value={spec.phone} onChange={e => setSpec({ ...spec, phone: e.target.value })} dir="ltr" />
            <select value={spec.request_type || 'fresh_case'} onChange={e => setSpec({ ...spec, request_type: e.target.value })} style={{ maxWidth: 160 }}>
              <option value="fresh_case">Fresh Case</option>
              <option value="additional_reports">Additional Reports</option>
              <option value="second_review">Second Review</option>
              <option value="follow_up">Follow-Up Review</option>
            </select>
            <button disabled={!spec.name || !spec.phone} onClick={() => run(() => api.post(`/cases/${c.id}/reviews/dispatch`, { specialist_name: spec.name, specialist_phone: spec.phone, request_type: spec.request_type || 'fresh_case' }))}>Dispatch Review</button>
          </div>
        </div>
      )}

      {/* Bridge 1: Refer to Saudi Hospital Clinic */}
      {['INITIAL_REVIEW', 'READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div style={{ marginTop: 14, border: '1px solid #000', padding: 12, background: '#fafafa' }}>
          <h3>🏥 {t('referHospital')} (Bridge 1)</h3>
          {c.hospital_handoff ? (
            <div>
              <p>✓ <strong>Referred to:</strong> {c.hospital_handoff.hospital_name || c.hospital_handoff.hospital_id}</p>
              <p className="muted">Appointment: {c.hospital_handoff.appointment_date} {c.hospital_handoff.appointment_time} · Case: {c.hospital_handoff.hospital_case_number}</p>
              <span className="badge" style={{ fontSize: 16 }}>Check-in Code: {c.hospital_handoff.checkin_code}</span>
            </div>
          ) : (
            <Bridge1ReferralForm caseId={c.id} onReferred={reload} />
          )}
        </div>
      )}

      {/* Bilingual AI Summary Panel */}
      <div style={{ marginTop: 14, border: '1px solid #000', padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>🤖 {t('aiSummary')} [{c.ai_summary_status || 'none'}]</h3>
          <div className="row">
            <button onClick={() => run(() => api.post(`/cases/${c.id}/ai-summary/generate`))}>
              {c.ai_summary_en ? 'Regenerate' : 'Generate AI Summary'}
            </button>
            {c.ai_summary_en && c.ai_summary_status !== 'approved' && (
              <button onClick={() => run(() => api.post(`/cases/${c.id}/ai-summary/approve`))}>{t('aiApprove')}</button>
            )}
          </div>
        </div>
        {c.ai_summary_en && (
          <div style={{ marginTop: 8 }}>
            <p><strong>Clinical Presentation:</strong> {c.ai_summary_en.clinical_presentation}</p>
            {c.ai_summary_en.key_findings && (
              <p className="muted"><strong>Key Findings:</strong> {c.ai_summary_en.key_findings.join('; ')}</p>
            )}
            {c.ai_summary_en.pending_questions && (
              <p className="muted"><strong>Pending Questions:</strong> {c.ai_summary_en.pending_questions.join('; ')}</p>
            )}
          </div>
        )}
      </div>

      {/* Itemized Reports Request Panel */}
      <div style={{ marginTop: 14, border: '1px solid #000', padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>📋 {t('reportsChecklist')}</h3>
          <ItemizedReportsModal caseId={c.id} onRequested={reload} />
        </div>
      </div>

      {latestLink && (
        <div style={{ marginTop: 8 }}>
          <h3>{t('reviewStatus')}: {linkState}{latestLink.revoked_at ? ` [${t('linkRevoked')}]` : ''}</h3>
          <p className="muted">{latestLink.specialist_name} · {latestLink.specialist_phone} · {t('expires')}: {fmtDate(latestLink.expires_at)}</p>
          <div className="row">
            {!latestLink.revoked_at && <button onClick={() => run(() => api.post(`/cases/${c.id}/revoke-link`))}>{t('revokeLink')}</button>}
          </div>
        </div>
      )}

      {c.service_type === 'SERVICE' && ['SPECIALIST_ASSIGNED', 'IN_PROGRESS'].includes(c.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          {/* DEC-031: SERVICE cases complete here — previously API-only (P3 dead end). */}
          <button onClick={() => { if (window.confirm(t('confirmSubmit'))) run(() => api.patch(`/cases/${c.id}/status`, { to: 'COMPLETED', version: c.version, note: 'Service delivered' })); }}>{t('completeService')}</button>
        </div>
      )}

      {c.status === 'REPORT_SUBMITTED' && reportText && (
        <div style={{ marginTop: 8 }}>
          <h3>{t('reportPreview')}</h3>
          <pre className="report">{reportText}</pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => { if (window.confirm(t('confirmSubmit'))) run(() => api.post(`/cases/${c.id}/release`)); }}>{t('release')}</button>
            <a
              className="btn"
              href={`/api/v1/cases/${c.id}/report/pdf`}
              download={`Medical_Report_${c.case_number}.pdf`}
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Download PDF Report
            </a>
          </div>
        </div>
      )}

      {!['COMPLETED', 'CANCELLED', 'FOLLOW_UP'].includes(c.status) && (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <input style={{ maxWidth: 280 }} placeholder={t('escalateNote')} value={escNote} onChange={e => setEscNote(e.target.value)} />
            <button onClick={() => run(() => api.post(`/cases/${c.id}/escalate`, { note: escNote }))}>{t('escalate')}</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input style={{ maxWidth: 280 }} placeholder={t('cancelReason')} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            <button disabled={!cancelReason.trim()} onClick={() => { if (window.confirm(t('confirmSubmit'))) run(() => api.post(`/cases/${c.id}/cancel`, { reason: cancelReason })); }}>{t('cancelCase')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function NursePanel({ c, reload }) {
  const { t } = useI18n();
  const [state, run] = useAction(reload);
  const [v, setV] = useState({ blood_pressure: '', heart_rate: '', temperature: '', weight: '', height: '', spo2: '', nursing_notes: '' });
  const required = REQUIRED_DOCS[c.service_type] || [];
  const have = new Set((c.documents || []).map(d => d.category));
  const readOnly = c.intake_completed;

  return (
    <section className="box">
      <h2>{t('nurse')} — {t('vitals')}</h2>
      <ActionMsg state={state} />
      {readOnly && <p className="muted">[{t('intakeDone')}]</p>}
      <h3>{t('checklist')}</h3>
      <table>
        <tbody>
          {required.map(cat => (
            <tr key={cat}><td>{cat}</td><td>{have.has(cat) ? `[${t('uploaded')}]` : <strong>[{t('missing')}]</strong>}</td></tr>
          ))}
          {!required.length && <tr><td className="muted">{t('noItems')}</td></tr>}
        </tbody>
      </table>
      {!readOnly && (
        <>
          <div className="grid2">
            <Field label={t('bp')}><input value={v.blood_pressure} onChange={e => setV({ ...v, blood_pressure: e.target.value })} placeholder="120/80" /></Field>
            <Field label={t('hr')}><input type="number" value={v.heart_rate} onChange={e => setV({ ...v, heart_rate: e.target.value })} /></Field>
            <Field label={t('temp')}><input type="number" step="0.1" value={v.temperature} onChange={e => setV({ ...v, temperature: e.target.value })} /></Field>
            <Field label={t('weight')}><input type="number" step="0.1" value={v.weight} onChange={e => setV({ ...v, weight: e.target.value })} /></Field>
            <Field label={t('height')}><input type="number" value={v.height} onChange={e => setV({ ...v, height: e.target.value })} /></Field>
            <Field label={t('spo2')}><input type="number" value={v.spo2} onChange={e => setV({ ...v, spo2: e.target.value })} /></Field>
          </div>
          <Field label={t('nursingNotes')}><textarea value={v.nursing_notes} onChange={e => setV({ ...v, nursing_notes: e.target.value })} /></Field>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => run(() => api.post(`/cases/${c.id}/vitals`, v))}>{t('save')}</button>
            <button onClick={() => run(() => api.post(`/cases/${c.id}/intake-complete`))}>{t('completeIntake')}</button>
          </div>
        </>
      )}
      {!!c.vitals?.length && (
        <table>
          <thead><tr><th>{t('time')}</th><th>{t('bp')}</th><th>{t('hr')}</th><th>{t('temp')}</th><th>{t('spo2')}</th><th>{t('nursingNotes')}</th></tr></thead>
          <tbody>
            {c.vitals.map(x => (
              <tr key={x.id}><td>{fmtDate(x.created_at)}</td><td>{x.blood_pressure || '—'}</td><td>{x.heart_rate ?? '—'}</td><td>{x.temperature ?? '—'}</td><td>{x.spo2 ?? '—'}</td><td>{x.nursing_notes || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DoctorPanel({ c, reload }) {
  const { t } = useI18n();
  const [state, run] = useAction(reload);
  const [notes, setNotes] = useState(null);
  const [savedAt, setSavedAt] = useState('');
  const dirty = useRef(false);
  const [report, setReport] = useState('');
  const [fu, setFu] = useState({ on: false, timeframe: '', type: 'ONLINE', reason: '' });
  const [rxTab, setRxTab] = useState('FORMULARY');
  const [formulary, setFormulary] = useState([]);
  const [rx, setRx] = useState({ drug_name: '', dosage: '', frequency: '', duration: '', route: '', special_instructions: '', formulary_id: '' });
  const [parentCtx, setParentCtx] = useState(null);

  useEffect(() => {
    api.get('/formulary').then(r => setFormulary(r.data)).catch(() => {});
    if (c.parent_case_id) api.get(`/cases/${c.id}/parent-context`).then(r => setParentCtx(r.data.parent)).catch(() => {});
  }, [c.id, c.parent_case_id]);

  useEffect(() => {
    if (notes === null && c.consultation) setNotes({ chief_complaint: '', findings: '', diagnosis: '', plan: '', free_text: '', ...(c.consultation.notes_draft || {}) });
  }, [c.consultation, notes]);

  // US-DOC-004 AC1: auto-save draft every 60 seconds.
  useEffect(() => {
    const iv = setInterval(() => {
      if (dirty.current && notes) {
        api.post(`/cases/${c.id}/notes`, notes).then(r => { dirty.current = false; setSavedAt(r.data.saved_at); }).catch(() => {});
      }
    }, 60_000);
    return () => clearInterval(iv);
  }, [notes, c.id]);

  const setNote = (k, val) => { dirty.current = true; setNotes({ ...notes, [k]: val }); };
  const saveNotes = () => run(async () => { const r = await api.post(`/cases/${c.id}/notes`, notes); dirty.current = false; setSavedAt(r.data.saved_at); }, t('autosaved'));

  const pickDrug = id => {
    const d = formulary.find(x => x.id === id);
    if (!d) return setRx({ ...rx, formulary_id: '', drug_name: '' });
    setRx({ ...rx, formulary_id: d.id, drug_name: d.generic_name, dosage: d.common_dosages?.[0] || '', route: d.route || '' });
  };

  const joinable = c.consultation?.meet_url && c.consultation.scheduled_at && Date.now() >= new Date(c.consultation.scheduled_at).getTime() - 15 * 60_000;
  const canWrite = ['APPOINTMENT_SCHEDULED', 'IN_PROGRESS'].includes(c.status);
  const canReport = c.status === 'IN_PROGRESS' && !c.consultation?.submitted_at;

  return (
    <section className="box">
      <h2>{t('doctor')} — {t('notes')}</h2>
      <ActionMsg state={state} />

      {parentCtx && (
        <details open>
          <summary>{t('previousConsultation')} — {parentCtx.case_number}</summary>
          <div className="inner">
            {parentCtx.consultation?.final_report && <pre className="report">{parentCtx.consultation.final_report}</pre>}
            {parentCtx.consultation?.notes_draft?.diagnosis && <p>{t('diagnosis')}: {parentCtx.consultation.notes_draft.diagnosis}</p>}
            {parentCtx.review && <pre className="report">{`FINDINGS:\n${parentCtx.review.findings}\n\nRECOMMENDATION:\n${parentCtx.review.recommendation}`}</pre>}
          </div>
        </details>
      )}

      {!!c.vitals?.length && (
        <p className="muted">{t('vitals')}: BP {c.vitals[0].blood_pressure || '—'} · HR {c.vitals[0].heart_rate ?? '—'} · T {c.vitals[0].temperature ?? '—'} · SpO2 {c.vitals[0].spo2 ?? '—'} {c.vitals[0].nursing_notes ? `· ${c.vitals[0].nursing_notes}` : ''}</p>
      )}

      <div className="row">
        {joinable && <a className="btn" href={c.consultation.meet_url} target="_blank" rel="noreferrer">{t('join')} →</a>}
        {c.status === 'APPOINTMENT_SCHEDULED' && <button onClick={() => run(() => api.post(`/cases/${c.id}/start`))}>{t('start')}</button>}
      </div>

      {notes && canWrite && (
        <>
          <div className="grid2">
            <Field label={t('chiefComplaint')}><input value={notes.chief_complaint} onChange={e => setNote('chief_complaint', e.target.value)} /></Field>
            <Field label={t('diagnosis')}><input value={notes.diagnosis} onChange={e => setNote('diagnosis', e.target.value)} /></Field>
          </div>
          <Field label={t('findings')}><textarea value={notes.findings} onChange={e => setNote('findings', e.target.value)} /></Field>
          <Field label={t('plan')}><textarea value={notes.plan} onChange={e => setNote('plan', e.target.value)} /></Field>
          <div className="row">
            <button onClick={saveNotes}>{t('save')}</button>
            {savedAt && <span className="muted">{t('savedAt')}: {fmtDate(savedAt)} ({t('autosaved')} 60s)</span>}
          </div>
        </>
      )}

      {canReport && (
        <div style={{ marginTop: 12 }}>
          <h3>{t('submitReport')}</h3>
          <textarea value={report} onChange={e => setReport(e.target.value)} placeholder={t('report')} />
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={fu.on} onChange={e => setFu({ ...fu, on: e.target.checked })} /> {t('followUpRecommended')}
          </label>
          {fu.on && (
            <div className="grid2">
              <Field label={t('timeframe')}><input value={fu.timeframe} onChange={e => setFu({ ...fu, timeframe: e.target.value })} /></Field>
              <Field label={t('fuReason')}><input value={fu.reason} onChange={e => setFu({ ...fu, reason: e.target.value })} /></Field>
            </div>
          )}
          <button disabled={!report.trim()} onClick={() => {
            if (!window.confirm(t('confirmSubmit'))) return;
            run(() => api.post(`/cases/${c.id}/report`, { report, follow_up_recommended: fu.on, follow_up_timeframe: fu.timeframe, follow_up_type: fu.type, follow_up_reason: fu.reason }));
          }}>{t('submitReport')}</button>
        </div>
      )}

      {c.consultation?.submitted_at && <p className="muted">[{t('submitted')}: {fmtDate(c.consultation.submitted_at)}]</p>}

      {canWrite && (
        <div style={{ marginTop: 12 }}>
          <h3>{t('prescriptions')}</h3>
          <div className="tabs">
            <button className={rxTab === 'FORMULARY' ? 'active' : ''} onClick={() => setRxTab('FORMULARY')}>{t('formulary')}</button>
            <button className={rxTab === 'FREE_TEXT' ? 'active' : ''} onClick={() => setRxTab('FREE_TEXT')}>{t('freeText')}</button>
          </div>
          {rxTab === 'FORMULARY' && (
            <Field label={t('formulary')}>
              <select value={rx.formulary_id} onChange={e => pickDrug(e.target.value)}>
                <option value="">—</option>
                {formulary.map(d => <option key={d.id} value={d.id}>{d.generic_name}{d.brand_name ? ` (${d.brand_name})` : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="grid2">
            <Field label={t('drugName')}><input value={rx.drug_name} onChange={e => setRx({ ...rx, drug_name: e.target.value })} /></Field>
            <Field label={t('dosage')}><input value={rx.dosage} onChange={e => setRx({ ...rx, dosage: e.target.value })} /></Field>
            <Field label={t('frequency')}><input value={rx.frequency} onChange={e => setRx({ ...rx, frequency: e.target.value })} /></Field>
            <Field label={t('duration')}><input value={rx.duration} onChange={e => setRx({ ...rx, duration: e.target.value })} /></Field>
            <Field label={t('route')}><input value={rx.route} onChange={e => setRx({ ...rx, route: e.target.value })} /></Field>
            <Field label={t('instructions')}><input value={rx.special_instructions} onChange={e => setRx({ ...rx, special_instructions: e.target.value })} /></Field>
          </div>
          <button disabled={!rx.drug_name.trim()} onClick={() => run(async () => {
            await api.post(`/cases/${c.id}/prescriptions`, { ...rx, source: rxTab });
            setRx({ drug_name: '', dosage: '', frequency: '', duration: '', route: '', special_instructions: '', formulary_id: '' });
          })}>{t('addRx')}</button>
        </div>
      )}

      {!!c.prescriptions?.length && (
        <table>
          <thead><tr><th>{t('drugName')}</th><th>{t('dosage')}</th><th>{t('frequency')}</th><th>{t('duration')}</th><th>{t('route')}</th><th>{t('type')}</th></tr></thead>
          <tbody>
            {c.prescriptions.map(x => (
              <tr key={x.id}><td>{x.drug_name}</td><td>{x.dosage || '—'}</td><td>{x.frequency || '—'}</td><td>{x.duration || '—'}</td><td>{x.route || '—'}</td><td>{x.source}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Bridge1ReferralForm({ caseId, onReferred }) {
  const { t } = useI18n();
  const [hospitals, setHospitals] = useState([]);
  const [hospId, setHospId] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptTime, setApptTime] = useState('10:00');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/admin/hospitals').then(r => setHospitals(r.data.hospitals || [])).catch(() => {});
  }, []);

  const doRefer = async (e) => {
    e?.preventDefault();
    if (!hospId) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/cases/${caseId}/refer-to-hospital`, {
        hospital_id: hospId,
        appointment_date: apptDate || new Date().toISOString().split('T')[0],
        appointment_time: apptTime || '10:00',
        nurse_interview_summary: summary || 'Referred from online triage consultation'
      });
      onReferred?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={doRefer} style={{ marginTop: 8 }}>
      <Msg err={err} />
      <div className="grid2">
        <Field label="Target Saudi Hospital">
          <select required value={hospId} onChange={e => setHospId(e.target.value)}>
            <option value="">-- Choose Hospital --</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
          </select>
        </Field>
        <Field label="Appointment Date">
          <input type="date" value={apptDate} onChange={e => setApptDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid2">
        <Field label="Appointment Time">
          <input type="time" value={apptTime} onChange={e => setApptTime(e.target.value)} />
        </Field>
        <Field label="Referral Note">
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Triage referral note" />
        </Field>
      </div>
      <button type="submit" disabled={busy || !hospId} style={{ marginTop: 8 }}>
        {busy ? t('loading') : 'Book Slot & Generate Check-in Code'}
      </button>
    </form>
  );
}

function ItemizedReportsModal({ caseId, onRequested }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([{ name: '', required: true, category: 'Medical Report' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const addItem = () => setItems([...items, { name: '', required: true, category: 'Medical Report' }]);

  const doSubmit = async (e) => {
    e?.preventDefault();
    const valid = items.filter(i => i.name.trim());
    if (!valid.length) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/cases/${caseId}/reports-requests`, { items: valid, notes });
      setOpen(false);
      onRequested?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button onClick={() => setOpen(true)}>+ Request Checklist Items</button>;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="box" style={{ background: '#fff', maxWidth: 520, width: '90%' }}>
        <h3>Request Missing Reports Checklist</h3>
        <Msg err={err} />
        <form onSubmit={doSubmit}>
          {items.map((it, idx) => (
            <div key={idx} className="row" style={{ marginBottom: 6 }}>
              <input
                required
                style={{ flex: 1 }}
                placeholder={`Item ${idx + 1} (e.g. ECG Strip)`}
                value={it.name}
                onChange={e => {
                  const copy = [...items];
                  copy[idx].name = e.target.value;
                  setItems(copy);
                }}
              />
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={it.required}
                  onChange={e => {
                    const copy = [...items];
                    copy[idx].required = e.target.checked;
                    setItems(copy);
                  }}
                /> Req
              </label>
            </div>
          ))}
          <button type="button" onClick={addItem} style={{ fontSize: 12, padding: '2px 8px', margin: '4px 0' }}>+ Add Item</button>
          <Field label="Instructions Note for Patient">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Please upload scans in original quality..." style={{ minHeight: 60 }} />
          </Field>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy}>{busy ? t('loading') : 'Send Checklist via WhatsApp'}</button>
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CaseOps() {
  const { id } = useParams();
  const { t } = useI18n();
  const { session } = useAuth();
  const role = session?.role;
  const { data: c, err, loading, reload } = useAsync(() => api.get(`/cases/${id}`).then(r => r.data), [id]);

  if (loading && !c) return <p>{t('loading')}</p>;
  if (err) return <Msg err={err} />;
  if (!c) return null;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{c.case_number}</h1>
        <button onClick={reload}>{t('refresh')}</button>
      </div>
      <p><StatusBadge status={c.status} /> <span className="muted">{c.service_type}{c.service_subtype ? ` / ${c.service_subtype}` : ''} · {c.specialty || ''} · {t('created')}: {fmtDate(c.created_at)}</span></p>
      {c.escalated && <p><strong>[{t('escalate')}]</strong></p>}

      <section className="box">
        <h2>{t('patientInfo')}</h2>
        <p>{c.patient?.full_name} · {c.patient?.phone} · {c.patient?.dob || '—'} · {c.patient?.gender || '—'} · {c.patient?.nationality || '—'}</p>
        <h3>{t('reason')}</h3><p>{c.reason}</p>
        {c.history && Object.keys(c.history).length > 0 && (
          <p className="muted">
            {t('symptoms')}: {c.history.symptoms || '—'} · {t('medications')}: {c.history.medications || '—'} · {t('allergies')}: {c.history.allergies || '—'} · {t('diagnosis')}: {c.history.diagnosis || '—'}
            {c.history.preferred_time ? ` · ${t('appointmentTime')}: ${fmtDate(c.history.preferred_time)}` : ''}
          </p>
        )}
        {c.purpose && <p>{t('purpose')}: {c.purpose}</p>}
      </section>

      {role === 'coordinator' && <CoordinatorPanel c={c} reload={reload} />}
      {role === 'nurse' && <NursePanel c={c} reload={reload} />}
      {role === 'doctor' && <DoctorPanel c={c} reload={reload} />}

      <section className="box">
        <h2>{t('assignments')}</h2>
        {!c.assignments?.length && <p className="muted">{t('noItems')}</p>}
        {c.assignments?.map(a => <p key={a.id}>{a.staff?.full_name || a.staff_id} — {t(a.role || 'nurse')}{a.staff?.specialty ? ` · ${a.staff.specialty}` : ''}</p>)}
      </section>

      <section className="box">
        <h2>{t('documents')}</h2>
        <DocumentList caseId={c.id} documents={c.documents} canDelete={role === 'coordinator' || role === 'admin'} onChanged={reload} />
        {['nurse', 'coordinator'].includes(role) && <FileUploader caseId={c.id} onUploaded={reload} />}
      </section>

      {c.review && role !== 'nurse' && (
        <section className="box">
          <h2>{t('intlReviews')} [{c.review.status}]</h2>
          {c.review.findings && <pre className="report">{`FINDINGS:\n${c.review.findings}\n\nRECOMMENDATION:\n${c.review.recommendation || ''}`}</pre>}
        </section>
      )}

      <section className="box">
        <h2>{t('internalTimeline')}</h2>
        <Timeline events={c.timeline} internal />
      </section>

      <Link className="btn" to="/staff">{t('back')}</Link>
    </div>
  );
}