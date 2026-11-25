// Role-aware case console: coordinator ops (US-CRD), nurse intake (US-NUR), doctor clinical (US-DOC).
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, StatusBadge, Timeline, DocumentList, FileUploader, useAsync, ActionButton } from '../../components/ui';
import CaseStepper from '../../components/CaseStepper';

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

function NurseDesk({ c, reload }) {
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
  const [tripartite, setTripartite] = useState(true);
  const [triSpecialist, setTriSpecialist] = useState({ name: '', phone: '' });
  const [cancelReason, setCancelReason] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [intlConsultants, setIntlConsultants] = useState([]);
  const [manualSpec, setManualSpec] = useState(false);

  // De-identification, Translation & 3 Compulsory Questions state
  const [deidConsent, setDeidConsent] = useState(Boolean(c.history?.deidentified_consent));
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [deidFile, setDeidFile] = useState(null);
  const [deidUploading, setDeidUploading] = useState(false);
  const [questions, setQuestions] = useState(
    Array.isArray(c.history?.nurse_questions) && c.history.nurse_questions.length === 3
      ? c.history.nurse_questions
      : ['', '', '']
  );
  const [transEnReason, setTransEnReason] = useState(c.history?.translated_reason_en || c.reason || '');
  const [transEnHistory, setTransEnHistory] = useState(c.history?.translated_history_en || '');
  const [finalReportAr, setFinalReportAr] = useState(c.final_report_ar || '');

  const allQuestionsFilled = questions.every(q => String(q || '').trim().length > 0);
  const canDispatchToConsultant = deidConsent && allQuestionsFilled;

  // Sort International Consultants so matching case specialty appears first
  const sortedConsultants = [...intlConsultants].sort((a, b) => {
    const aMatch = c.specialty && a.specialty?.toLowerCase() === c.specialty.toLowerCase() ? 0 : 1;
    const bMatch = c.specialty && b.specialty?.toLowerCase() === c.specialty.toLowerCase() ? 0 : 1;
    return aMatch - bMatch || a.full_name.localeCompare(b.full_name);
  });

  const uploadDeidentifiedDoc = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!deidFile) return;
    setDeidUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', deidFile);
      fd.append('category', 'De-identified Medical Report');
      fd.append('is_deidentified', 'true');
      await api.post(`/cases/${c.id}/documents`, fd);
      setDeidFile(null);
      setShowConsentModal(true);
      reload();
    } catch (err) {
      alert(errMsg(err));
    } finally {
      setDeidUploading(false);
    }
  };

  useEffect(() => {
    api.get('/staff/directory').then(r => setDirectory(r.data)).catch(() => {});
    api.get('/staff/intl-specialists').then(r => setIntlConsultants(r.data?.specialists || [])).catch(() => {});
  }, []);

  const latestLink = c.magic_links?.[0];
  const linkState = latestLink
    ? (latestLink.submitted_at ? t('submitted') : latestLink.draft_saved_at ? t('draftSaved') : latestLink.opened_at ? t('opened') : t('sent'))
    : null;
  const latestCaseRev = c.case_reviews?.[c.case_reviews.length - 1];
  const reportText = c.consultation?.final_report
    || (c.review?.status === 'SUBMITTED' ? `FINDINGS:\n${c.review.findings}\n\nRECOMMENDATION:\n${c.review.recommendation}` : null)
    || (latestCaseRev?.clinical_findings ? `FINDINGS:\n${latestCaseRev.clinical_findings}\n\nRECOMMENDATION:\n${latestCaseRev.recommendations || latestCaseRev.diagnostic_assessment}` : null)
    || c.final_report_en
    || (c.status === 'REPORT_SUBMITTED' ? 'Medical specialist has submitted the opinion report. Ready for review and release.' : null);

  const required = REQUIRED_DOCS[c.service_type] || [];
  const have = new Set((c.documents || []).map(d => d.category));
  const readOnlyIntake = c.intake_completed;

  return (
    <section className="box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🩺 ALO Nurse Desk — Unified Care Stream Command</h2>
      </div>
      <ActionMsg state={state} />

      {/* De-Identification, Document Re-Upload, Translation & 3 Compulsory Questions */}
      <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>🛡️ Nurse Prep: De-Identification, Translation & 3 Questions</h3>
          <span className="badge" style={{ background: deidConsent && allQuestionsFilled ? '#dcfce7' : '#fef3c7', color: deidConsent && allQuestionsFilled ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
            {deidConsent && allQuestionsFilled ? '✓ Ready for Consultant' : 'Action Required'}
          </span>
        </div>

        {/* 1. Patient Documents Download & De-Identified Re-Upload */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <strong style={{ fontSize: '0.9rem' }}>1. Download Patient Documents & Upload De-Identified Files</strong>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: '0.82rem' }}>
            Download the patient&apos;s original documents, hide/redact all patient-identifying information (Name, ID/Iqama, Phone, File No.), and re-upload below. Only de-identified files are sent to the International Consultant.
          </p>
          {(c.documents || []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {(c.documents || []).map(d => (
                <div key={d.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #e2e8f0', fontSize: '0.85rem' }}>
                  <span>
                    {d.is_deidentified || d.category === 'De-identified Medical Report' ? '🟢 [De-Identified] ' : '📄 '}
                    <strong>{d.file_name}</strong> <span className="muted">({d.category})</span>
                  </span>
                  <a href={`/api/v1/cases/${c.id}/documents/${d.id}?download=1`} target="_blank" rel="noreferrer" className="btn" style={{ padding: '2px 8px', fontSize: '0.78rem', textDecoration: 'none' }}>
                    ⬇ Download
                  </a>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={uploadDeidentifiedDoc} className="row" style={{ gap: 8, marginTop: 8 }}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={e => setDeidFile(e.target.files?.[0] || null)} />
            <button type="submit" disabled={!deidFile || deidUploading} className="btn">
              {deidUploading ? 'Uploading...' : '⬆ Upload De-Identified Document'}
            </button>
          </form>
        </div>

        {/* Consent Popup Modal right after uploading de-identified file */}
        {showConsentModal && (
          <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 6px', color: '#991b1b' }}>⚠️ Saudi Healthcare Privacy Consent (PDPL / MOH)</h4>
            <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#7f1d1d' }}>
              Have you hidden/redacted all patient-identifying information (Full Name, Iqama/National ID, Phone Number, Hospital File No.) from the uploaded documents as required by Saudi law?
            </p>
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                onClick={() => { setDeidConsent(true); setShowConsentModal(false); }}
                style={{ background: '#16a34a', borderColor: '#16a34a', color: '#fff', fontWeight: 600 }}
              >
                ✓ Yes, Patient Info is Hidden (Confirm Consent)
              </button>
              <button type="button" className="btn" onClick={() => setShowConsentModal(false)}>
                Close
              </button>
            </div>
          </div>
        )}

        {/* 2. Arabic -> English Translation for International Consultant */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <strong style={{ fontSize: '0.9rem' }}>2. Bilingual View & English Translation (Sent to Consultant)</strong>
          <div className="grid2" style={{ marginTop: 8, gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Patient Original Submission (Arabic / English):</label>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: 8, fontSize: '0.85rem', minHeight: 70 }}>
                <div><strong>Reason:</strong> {c.reason || '—'}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Symptoms: {c.history?.symptoms || '—'} · Diagnosis: {c.history?.diagnosis || '—'} · Meds: {c.history?.medications || '—'}
                </div>
              </div>
            </div>
            <div>
              <Field label="English Clinical Summary for International Consultant">
                <textarea
                  value={transEnReason}
                  onChange={e => setTransEnReason(e.target.value)}
                  placeholder="Translate or refine the patient's complaint into clear English for the International Consultant..."
                  style={{ minHeight: 70 }}
                />
              </Field>
            </div>
          </div>
          <Field label="Additional English Clinical History (Optional)">
            <input
              value={transEnHistory}
              onChange={e => setTransEnHistory(e.target.value)}
              placeholder="Translated symptoms, past history, or medications in English..."
            />
          </Field>
        </div>

        {/* 3. 3 Compulsory Questions for International Consultant */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <strong style={{ fontSize: '0.9rem' }}>3. Compulsory Clinical Questions for Consultant (All 3 Required) *</strong>
          <p className="muted" style={{ margin: '2px 0 8px', fontSize: '0.82rem' }}>
            The International Consultant must answer all 3 questions before they can submit their opinion.
          </p>
          {[0, 1, 2].map(idx => (
            <Field key={idx} label={`Question ${idx + 1} *`}>
              <input
                value={questions[idx] || ''}
                onChange={e => {
                  const next = [...questions];
                  next[idx] = e.target.value;
                  setQuestions(next);
                }}
                placeholder={`Enter compulsory clinical question ${idx + 1} in English...`}
              />
            </Field>
          ))}
        </div>

        {/* 4. Mandatory Saudi Law Consent Checkbox */}
        <div style={{ background: deidConsent ? '#f0fdf4' : '#fef2f2', border: `1px solid ${deidConsent ? '#86efac' : '#fca5a5'}`, borderRadius: 6, padding: 10 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem', color: deidConsent ? '#166534' : '#991b1b' }}>
            <input type="checkbox" checked={deidConsent} onChange={e => setDeidConsent(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Saudi Law Compliance (PDPL / MOH): I confirm that all patient-identifying information has been hidden/redacted from the documents before sending to the International Consultant. *
            </span>
          </label>
        </div>

        {!readOnlyIntake && (
          <div className="row" style={{ marginTop: 10 }}>
            <button
              onClick={() => run(() => api.post(`/cases/${c.id}/intake-complete`), 'Nurse review completed!')}
              style={{ background: '#059669', borderColor: '#059669', color: '#fff', fontWeight: 600, padding: '6px 14px' }}
            >
              ✓ Complete Nurse Prep
            </button>
          </div>
        )}
      </div>

      {/* Case Progression & Actions */}
      <div style={{ background: '#f8f8f8', borderLeft: '4px solid #0284c7', padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong>Case Status:</strong> <StatusBadge status={c.status} />
        </div>
        {c.status === 'INITIAL_REVIEW' && (
          <p style={{ margin: '4px 0 0' }}>Review initial documents and clinical history. Click <strong>"{t('unassigned')} →"</strong> to mark ready for staff assignment, or request additional documents.</p>
        )}
        {c.status === 'READY_FOR_ASSIGNMENT' && (
          <p style={{ margin: '4px 0 0' }}>Assign a dedicated Doctor / Specialist below, or refer the case directly to a Saudi partner day-clinic.</p>
        )}
        {c.status === 'SPECIALIST_ASSIGNED' && (
          <p style={{ margin: '4px 0 0' }}>Doctor assigned. Coordinate appointment schedule, monitor opinion review, or release final report.</p>
        )}
      </div>

      {!c.payment_confirmed && ['SUBMITTED', 'INITIAL_REVIEW'].includes(c.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          <input style={{ maxWidth: 320 }} placeholder={t('paymentNote')} value={payNote} onChange={e => setPayNote(e.target.value)} />
          <button onClick={() => run(() => api.post(`/cases/${c.id}/confirm-payment`, { note: payNote }))}>{t('confirmPayment')} & Send Link</button>
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
          <select data-testid="assign-staff" style={{ maxWidth: 360 }} value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">Assign Doctor — SCFHS Privileged Specialist</option>
            {directory.filter(s => ['doctor', 'nurse'].includes(s.role)).map(s => (
              <option key={s.id} value={s.id}>{s.full_name} ({t(s.role)}{s.specialty ? ` · SCFHS: ${s.specialty}` : ''})</option>
            ))}
          </select>
          <button disabled={!staffId} onClick={() => run(() => api.post(`/cases/${c.id}/assign`, { staff_id: staffId }))}>{t('assign')}</button>
        </div>
      )}

      {c.service_type === 'CONSULTATION' && ['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', background: '#fdfdfe' }}>
          <h4 style={{ margin: '0 0 8px' }}>📅 Stream 2: Online Consultation Scheduling & Consultant Magic Link</h4>
          <div className="grid2">
            <Field label="Appointment Date & Time"><input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)} /></Field>
            <Field label="Google Meet Room Link (Paste valid Meet URL)">
              <input placeholder="https://meet.google.com/xxx-xxxx-xxx" value={meet} onChange={e => setMeet(e.target.value)} dir="ltr" />
            </Field>
          </div>
          <div style={{ marginTop: 8 }}>
            {tripartite && (
              <div style={{ marginTop: 8 }}>
                {!manualSpec && sortedConsultants.length > 0 ? (
                  <Field label={`Select International Consultant${c.specialty ? ` (Case Specialty: ${c.specialty})` : ''}`}>
                    <div className="row" style={{ gap: 8 }}>
                      <select
                        value={triSpecialist.id || ''}
                        onChange={e => {
                          const found = sortedConsultants.find(ic => ic.id === e.target.value);
                          if (found) setTriSpecialist({ id: found.id, name: found.full_name, phone: found.phone_e164 || '' });
                          else setTriSpecialist({ id: '', name: '', phone: '' });
                        }}
                        style={{ flex: 1, minWidth: 260 }}
                      >
                        <option value="">— Select International Consultant —</option>
                        {sortedConsultants.map(ic => {
                          const isMatch = c.specialty && ic.specialty?.toLowerCase() === c.specialty.toLowerCase();
                          return (
                            <option key={ic.id} value={ic.id}>
                              {isMatch ? '★ ' : ''}{ic.full_name} — {ic.specialty || 'General Medicine'} ({ic.phone_e164 || 'No phone'})
                            </option>
                          );
                        })}
                      </select>
                      <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setManualSpec(true)}>Enter manually</button>
                    </div>
                  </Field>
                ) : (
                  <div>
                    <div className="grid2">
                      <Field label="Indian Specialist Name"><input placeholder="e.g. Dr. Ramesh Patel" value={triSpecialist.name} onChange={e => setTriSpecialist({ ...triSpecialist, name: e.target.value })} /></Field>
                      <Field label="Indian Specialist WhatsApp"><input placeholder="+91XXXXXXXXXX" value={triSpecialist.phone} onChange={e => setTriSpecialist({ ...triSpecialist, phone: e.target.value })} dir="ltr" /></Field>
                    </div>
                    {sortedConsultants.length > 0 && (
                      <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px', marginTop: 6 }} onClick={() => setManualSpec(false)}>← Choose from Consultant List</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {!canDispatchToConsultant && (
            <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '8px 0 0' }}>
              ⚠ Complete all 3 compulsory questions & tick the Saudi Privacy Consent box above before sending the Magic Link.
            </p>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <ActionButton
              disabled={!schedAt || (triSpecialist.name && !canDispatchToConsultant)}
              okText="Scheduled & Link Ready"
              onClick={async () => {
                const res = await api.post(`/cases/${c.id}/schedule`, {
                  scheduled_at: new Date(schedAt).toISOString(),
                  clinic_name: clinic.name || 'ALO Telehealth Room',
                  clinic_address: clinic.address || 'Online',
                  meet_url: meet,
                  is_tripartite: tripartite,
                  specialist_name: triSpecialist.name,
                  specialist_phone: triSpecialist.phone,
                  deidentified_consent: deidConsent,
                  questions,
                  translated_reason_en: transEnReason,
                  translated_history_en: transEnHistory
                });
                if (res.data?.review_url) {
                  const fullUrl = res.data.review_url.startsWith('http')
                    ? res.data.review_url
                    : window.location.origin + res.data.review_url;
                  setGeneratedLink(fullUrl);
                }
                reload();
              }}
              style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff', fontWeight: 600 }}
            >
              {tripartite ? '🔗 Confirm Slot & Send Magic Link' : 'Confirm Consultation Slot'}
            </ActionButton>
          </div>
        </div>
      )}

      {c.service_type === 'CONSULTATION' && c.consultation && (
        <div className="row" style={{ marginTop: 8 }}>
          <input style={{ maxWidth: 360 }} placeholder="Paste valid Google Meet link (https://meet.google.com/...)" value={meet} onChange={e => setMeet(e.target.value)} dir="ltr" />
          <ActionButton okText="Meet Link Updated" onClick={async () => { await api.patch(`/cases/${c.id}/meet-link`, { meet_url: meet }); reload(); }}>{t('meetLink')}</ActionButton>
          {c.consultation.meet_url && <span className="muted">{c.consultation.meet_url}</span>}
        </div>
      )}

      {c.service_type === 'GMO' && ['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', background: '#fdfdfe' }}>
          <h4 style={{ margin: '0 0 8px' }}>🌍 Stream 1: Written Second Opinion (Select International Consultant{c.specialty ? ` · ${c.specialty}` : ''})</h4>
          {!canDispatchToConsultant && (
            <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0 0 8px' }}>
              ⚠ Complete all 3 compulsory questions & tick the Saudi Privacy Consent box above to unlock sending the Magic Link.
            </p>
          )}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {!manualSpec && sortedConsultants.length > 0 ? (
              <>
                <select
                  value={spec.id || ''}
                  onChange={e => {
                    const found = sortedConsultants.find(ic => ic.id === e.target.value);
                    if (found) setSpec({ ...spec, id: found.id, name: found.full_name, phone: found.phone_e164 || '' });
                    else setSpec({ ...spec, id: '', name: '', phone: '' });
                  }}
                  style={{ minWidth: 260, flex: 1 }}
                >
                  <option value="">— Select International Consultant —</option>
                  {sortedConsultants.map(ic => {
                    const isMatch = c.specialty && ic.specialty?.toLowerCase() === c.specialty.toLowerCase();
                    return (
                      <option key={ic.id} value={ic.id}>
                        {isMatch ? '★ ' : ''}{ic.full_name} — {ic.specialty || 'General Medicine'} ({ic.phone_e164 || 'No phone'})
                      </option>
                    );
                  })}
                </select>
                <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setManualSpec(true)}>Enter manually</button>
              </>
            ) : (
              <>
                <input style={{ maxWidth: 200 }} placeholder={t('specialistName')} value={spec.name} onChange={e => setSpec({ ...spec, name: e.target.value })} />
                <input style={{ maxWidth: 180 }} placeholder="+91XXXXXXXXXX" value={spec.phone} onChange={e => setSpec({ ...spec, phone: e.target.value })} dir="ltr" />
                {sortedConsultants.length > 0 && (
                  <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setManualSpec(false)}>← Consultant List</button>
                )}
              </>
            )}
            <select value={spec.request_type || 'fresh_case'} onChange={e => setSpec({ ...spec, request_type: e.target.value })} style={{ maxWidth: 160 }}>
              <option value="fresh_case">Fresh Case</option>
              <option value="additional_reports">Additional Reports</option>
              <option value="second_review">Second Review</option>
              <option value="follow_up">Follow-Up Review</option>
            </select>
            <ActionButton
              disabled={!spec.name || !spec.phone || !canDispatchToConsultant}
              okText="Magic Link Sent"
              style={{ background: canDispatchToConsultant ? '#0284c7' : '#94a3b8', borderColor: canDispatchToConsultant ? '#0284c7' : '#94a3b8', color: '#fff', fontWeight: 600 }}
              onClick={async () => {
                const res = await api.post(`/cases/${c.id}/reviews/dispatch`, {
                  specialist_id: spec.id || undefined,
                  specialist_name: spec.name,
                  specialist_phone: spec.phone,
                  request_type: spec.request_type || 'fresh_case',
                  deidentified_consent: deidConsent,
                  questions,
                  translated_reason_en: transEnReason,
                  translated_history_en: transEnHistory
                });
                if (res.data?.review_url) {
                  const fullUrl = res.data.review_url.startsWith('http')
                    ? res.data.review_url
                    : window.location.origin + res.data.review_url;
                  setGeneratedLink(fullUrl);
                }
                reload();
              }}
            >
              🔗 Send Magic Link
            </ActionButton>
          </div>
        </div>
      )}

      {/* Bridge 1: Refer to Saudi Hospital Day-Clinic (Stream 3) */}
      {['INITIAL_REVIEW', 'READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED'].includes(c.status) && (
        <div style={{ marginTop: 14, border: '1px solid #cbd5e1', borderRadius: '8px', padding: 12, background: '#fafafa' }}>
          <h3>🏥 Stream 3: Refer to Saudi Hospital Partner Day-Clinic</h3>
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

      {/* Active Specialist Magic Link Console (Visible whenever a link exists, or for assigned/scheduled cases) */}
      {(generatedLink || latestLink || ['READY_FOR_ASSIGNMENT', 'SPECIALIST_ASSIGNED', 'APPOINTMENT_SCHEDULED', 'IN_PROGRESS', 'REVIEW_RECEIVED'].includes(c.status)) && (
        <div style={{ marginTop: 14, border: '1px solid #0284c7', borderRadius: '8px', padding: 14, background: '#f0f9ff' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, color: '#0369a1', display: 'flex', alignItems: 'center', gap: 6 }}>
              🔗 <span>Active Indian Specialist Magic Link</span>
            </h4>
            {latestLink && (
              <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '0.8rem' }}>
                Status: {linkState} {latestLink.revoked_at ? `[${t('linkRevoked')}]` : ''}
              </span>
            )}
          </div>

          {latestLink && (
            <p className="muted" style={{ margin: '6px 0 10px', fontSize: '0.85rem' }}>
              <strong>Doctor:</strong> {latestLink.specialist_name} · <strong>WhatsApp:</strong> {latestLink.specialist_phone} · <strong>Expires:</strong> {fmtDate(latestLink.expires_at)}
            </p>
          )}

          {generatedLink ? (
            <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 4, fontWeight: 600 }}>DIRECT SECURE URL (NO LOGIN / NO PASSWORD NEEDED):</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  readOnly
                  value={generatedLink}
                  style={{ flex: 1, minWidth: 260, fontFamily: 'monospace', fontSize: '0.82rem', padding: '6px 10px', background: '#f8fafc' }}
                  onClick={e => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedLink);
                    alert('Copied Magic Link to clipboard!');
                  }}
                  className="btn"
                  style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                >
                  📋 Copy Link
                </button>
                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn"
                  style={{ padding: '6px 12px', fontSize: '0.85rem', background: '#0284c7', color: '#fff', textDecoration: 'none', fontWeight: 600 }}
                >
                  ↗ Open Specialist Review
                </a>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => run(async () => {
                  const res = await api.post(`/cases/${c.id}/reissue-link`, {});
                  if (res.data?.review_url) {
                    const fullUrl = res.data.review_url.startsWith('http')
                      ? res.data.review_url
                      : window.location.origin + res.data.review_url;
                    setGeneratedLink(fullUrl);
                  }
                }, 'Specialist Magic Link ready to inspect')}
                style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff', fontSize: '0.85rem', padding: '6px 14px', fontWeight: 600 }}
              >
                🔗 Show / Open Specialist Magic Link
              </button>
            </div>
          )}

          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            {generatedLink && (
              <button
                type="button"
                onClick={() => run(async () => {
                  const res = await api.post(`/cases/${c.id}/reissue-link`, {});
                  if (res.data?.review_url) {
                    const fullUrl = res.data.review_url.startsWith('http')
                      ? res.data.review_url
                      : window.location.origin + res.data.review_url;
                    setGeneratedLink(fullUrl);
                  }
                }, 'New active token generated')}
                style={{ fontSize: '0.8rem', padding: '4px 8px' }}
              >
                🔄 Reissue New Link
              </button>
            )}
            {latestLink && !latestLink.revoked_at && (
              <button
                type="button"
                onClick={() => run(() => api.post(`/cases/${c.id}/revoke-link`))}
                style={{ fontSize: '0.8rem', padding: '4px 8px', color: '#dc2626' }}
              >
                {t('revokeLink')}
              </button>
            )}
          </div>
        </div>
      )}

      {c.service_type === 'SERVICE' && ['SPECIALIST_ASSIGNED', 'IN_PROGRESS'].includes(c.status) && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => { if (window.confirm(t('confirmSubmit'))) run(() => api.patch(`/cases/${c.id}/status`, { to: 'COMPLETED', version: c.version, note: 'Service delivered' })); }}>{t('completeService')}</button>
        </div>
      )}

      {/* Report Preview & Final Release to Patient */}
      {c.status === 'REPORT_SUBMITTED' && (
        <div style={{ marginTop: 14, border: '2px solid #16a34a', borderRadius: '8px', padding: 14, background: '#f0fdf4' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: '0 0 8px', color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
              📄 <span>Final Medical Opinion Report Preview</span>
            </h3>
            <span className="badge" style={{ background: '#dcfce7', color: '#166534', fontWeight: 600 }}>
              Status: Ready for Release
            </span>
          </div>
          <p className="muted" style={{ margin: '4px 0 10px', fontSize: '0.85rem' }}>
            The global specialist has submitted their clinical findings. Please review the report below before releasing it to the patient.
          </p>
          <pre className="report" style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '12px', whiteSpace: 'pre-wrap' }}>
            {reportText || 'No report text available'}
          </pre>
          <div style={{ marginTop: 12 }}>
            <Field label="Arabic Final Report for Patient (التقرير الطبي النهائي بالعربية — Required *)">
              <textarea
                dir="rtl"
                required
                value={finalReportAr}
                onChange={e => setFinalReportAr(e.target.value)}
                placeholder="اكتب الترجمة العربية الكاملة للتقرير الطبي (مطلوب قبل الإرسال للمريض)..."
                style={{ minHeight: 100, background: '#fff', borderColor: !finalReportAr.trim() ? '#fca5a5' : '#86efac' }}
              />
            </Field>
            {!finalReportAr.trim() && (
              <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '4px 0 0' }}>
                ⚠ Arabic translation is mandatory before releasing the final report to the patient.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <ActionButton
              disabled={!finalReportAr.trim()}
              okText="Released to Patient"
              style={{ background: finalReportAr.trim() ? '#16a34a' : '#94a3b8', borderColor: finalReportAr.trim() ? '#16a34a' : '#94a3b8', color: '#fff', fontWeight: 700, padding: '10px 22px', fontSize: '1rem', borderRadius: '6px', cursor: finalReportAr.trim() ? 'pointer' : 'not-allowed' }}
              onClick={async () => {
                if (!window.confirm(t('confirmSubmit') || 'Confirm release Arabic report to patient?')) return false;
                await api.post(`/cases/${c.id}/release`, { final_report_ar: finalReportAr.trim() });
                reload();
              }}
            >
              ✓ Release Final Report to Patient
            </ActionButton>
            <a
              className="btn"
              href={`/api/v1/cases/${c.id}/report/pdf`}
              download={`Medical_Report_${c.case_number}.pdf`}
              style={{ textDecoration: 'none', display: 'inline-block', padding: '10px 16px' }}
            >
              📥 Download PDF Report
            </a>
          </div>
        </div>
      )}

      {/* Completed & Delivered Report Badge & Preview for Staff */}
      {['COMPLETED', 'FOLLOW_UP'].includes(c.status) && (
        <div style={{ marginTop: 14, border: '1px solid #86efac', borderRadius: '8px', padding: 14, background: '#f0fdf4' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
              ✓ <span>Medical Report Released & Delivered to Patient</span>
            </h4>
            <span className="badge" style={{ background: '#dcfce7', color: '#166534', fontWeight: 600 }}>COMPLETED</span>
          </div>
          <pre className="report" style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '12px', marginTop: 10, whiteSpace: 'pre-wrap' }}>
            {reportText || c.final_report_en || 'Report released to patient'}
          </pre>
          <div style={{ marginTop: 10 }}>
            <a
              className="btn"
              href={`/api/v1/cases/${c.id}/report/pdf`}
              download={`Medical_Report_${c.case_number}.pdf`}
              style={{ textDecoration: 'none', display: 'inline-block', padding: '8px 14px' }}
            >
              📥 Download PDF Report
            </a>
          </div>
        </div>
      )}

      {!['COMPLETED', 'CANCELLED', 'FOLLOW_UP'].includes(c.status) && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ marginTop: 8 }}>
            <input style={{ maxWidth: 280 }} placeholder={t('cancelReason')} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
            <button disabled={!cancelReason.trim()} onClick={() => { if (window.confirm(t('confirmSubmit'))) run(() => api.post(`/cases/${c.id}/cancel`, { reason: cancelReason })); }}>{t('cancelCase')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

// Aliases for backward compatibility
const CoordinatorPanel = NurseDesk;
const NursePanel = NurseDesk;

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
    if (notes === null) {
      setNotes({
        chief_complaint: '',
        findings: '',
        diagnosis: '',
        plan: '',
        free_text: '',
        ...(c.consultation?.notes_draft || {})
      });
    }
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
  // DEC-072: Allow doctor to write and report directly on assigned cases (written opinion / consultation)
  const canWrite = ['SPECIALIST_ASSIGNED', 'APPOINTMENT_SCHEDULED', 'IN_PROGRESS', 'UNDER_MEDICAL_REVIEW'].includes(c.status);
  const canReport = ['SPECIALIST_ASSIGNED', 'APPOINTMENT_SCHEDULED', 'IN_PROGRESS', 'UNDER_MEDICAL_REVIEW'].includes(c.status) && !c.consultation?.submitted_at;

  return (
    <section className="box">
      <h2>{t('doctor')} — {t('notes')}</h2>
      <ActionMsg state={state} />

      {c.vitals?.[0] && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 14px', marginBottom: '14px', fontSize: '0.88rem' }}>
          <strong style={{ color: '#0f172a' }}>🩺 Nurse Triage Vitals:</strong>{' '}
          BP: {c.vitals[0].blood_pressure || '—'} · HR: {c.vitals[0].heart_rate ?? '—'} bpm · Temp: {c.vitals[0].temperature ?? '—'} °C · SpO2: {c.vitals[0].spo2 ?? '—'}% · Weight: {c.vitals[0].weight ?? '—'} kg
          {c.vitals[0].nursing_notes && <div style={{ marginTop: '4px', color: '#475569' }}><em>Triage Observations: {c.vitals[0].nursing_notes}</em></div>}
        </div>
      )}

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

      {/* Live Video Session & Tripartite Control Banner for Doctor */}
      {c.consultation?.meet_url && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', padding: '12px 14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong style={{ color: '#166534', display: 'block', fontSize: '0.95rem' }}>
              🔴 Live Video Room: {c.consultation.scheduled_at ? fmtDate(c.consultation.scheduled_at) : 'Active Session'}
            </strong>
            {c.magic_links?.[0]?.specialist_name ? (
              <span style={{ fontSize: '0.85rem', color: '#15803d' }}>
                🌐 Live Tripartite with Global Specialist: <strong>{c.magic_links[0].specialist_name}</strong> ({c.magic_links[0].specialist_phone})
              </span>
            ) : (
              <span style={{ fontSize: '0.85rem', color: '#15803d' }}>Direct Teleconsultation with Patient</span>
            )}
          </div>
          <a
            className="btn"
            href={c.consultation.meet_url}
            target="_blank"
            rel="noreferrer"
            style={{ background: '#16a34a', color: '#fff', fontWeight: 700, padding: '8px 16px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            🎥 Join Video Call (Google Meet) →
          </a>
        </div>
      )}

      <div className="row">
        {['SPECIALIST_ASSIGNED', 'APPOINTMENT_SCHEDULED'].includes(c.status) && (
          <button
            style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff', fontWeight: 600, padding: '6px 14px' }}
            onClick={() => run(() => api.post(`/cases/${c.id}/start`))}
          >
            ▶ {c.service_type === 'GMO' ? 'Start Medical Review' : t('start')}
          </button>
        )}
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
          <button
            disabled={!report.trim()}
            style={{ background: '#0284c7', borderColor: '#0284c7', color: '#fff', fontWeight: 600, padding: '8px 16px' }}
            onClick={() => {
              if (!window.confirm(t('confirmSubmit'))) return;
              run(() => api.post(`/cases/${c.id}/report`, { report, follow_up_recommended: fu.on, follow_up_timeframe: fu.timeframe, follow_up_type: fu.type, follow_up_reason: fu.reason }), 'Medical opinion submitted to ALO Nurse for final release');
            }}
          >
            ✓ {t('finalizeAndSubmit')}
          </button>
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

      {/* DEC-070: Live Courier Stepper at top of Case Operations */}
      <CaseStepper workflow={c.workflow} status={c.status} compact={false} />

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

      {['nurse', 'coordinator', 'admin'].includes(role) && <NurseDesk c={c} reload={reload} />}
      {['doctor', 'admin'].includes(role) && <DoctorPanel c={c} reload={reload} />}

      <section className="box">
        <h2>{t('assignments')}</h2>
        {!c.assignments?.length && <p className="muted">{t('noItems')}</p>}
        {c.assignments?.map(a => <p key={a.id}>{a.staff?.full_name || a.staff_id} — {t(a.role || 'nurse')}{a.staff?.specialty ? ` · ${a.staff.specialty}` : ''}</p>)}
      </section>

      <section className="box">
        <h2>{t('documents')}</h2>
        <DocumentList caseId={c.id} documents={c.documents} canDelete={['coordinator', 'nurse', 'admin'].includes(role)} onChanged={reload} />
        {['nurse', 'coordinator', 'admin'].includes(role) && <FileUploader caseId={c.id} onUploaded={reload} />}
      </section>

      {c.review && (
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