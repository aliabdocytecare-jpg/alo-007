// US-PAT-009/010/011/012/013 — unified patient case view.
// BR-016 patient-facing labels only; BR-023 Meet window; BR-015 release gating.
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, fmtDate, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, StatusBadge, Timeline, DocumentList, FileUploader, useAsync } from '../../components/ui';
import CaseStepper from '../../components/CaseStepper';

export default function CaseView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { data: c, err, loading, reload } = useAsync(() => api.get(`/cases/${id}?lang=${lang}`).then(r => r.data), [id, lang]);
  const { data: catalog } = useAsync(() => api.get('/catalog').then(r => r.data));

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Schedule Conflict');
  const [cancelDetail, setCancelDetail] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState('');

  const doCancelCase = async () => {
    setCancelErr('');
    setCancelBusy(true);
    try {
      const isWorsening = cancelReason === 'Worsening Symptoms / Medical Emergency';
      const finalReason = cancelReason === 'Other'
        ? (cancelDetail.trim() || 'Other')
        : (cancelDetail.trim() ? `${cancelReason}: ${cancelDetail}` : cancelReason);
      await api.post(`/cases/${c.id}/cancel`, {
        reason: finalReason,
        worsening: isWorsening
      });
      setCancelOpen(false);
      reload();
    } catch (e) {
      setCancelErr(errMsg(e));
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading && !c) return <p>{t('loading')}</p>;
  if (err) return <Msg err={err} />;
  if (!c) return null;

  // BR-016: never expose internal operational terminology to patients.
  const typeLabel = c.service_type === 'CONSULTATION' ? t('consultation') : c.service_type === 'GMO' ? t('gmo') : t('services');
  const subLabel = c.service_type === 'CONSULTATION'
    ? (c.service_subtype === 'IN_PERSON' ? t('inPerson') : c.service_subtype === 'FOLLOW_UP' ? t('followUp') : t('online'))
    : c.service_type === 'SERVICE'
      ? (catalog?.services?.find(s => s.code === c.service_subtype)?.[lang === 'ar' ? 'name_ar' : 'name_en'] || c.service_subtype)
      : null;

  const canCancel = !['COMPLETED', 'CANCELLED', 'FOLLOW_UP'].includes(c.status);
  const isScheduled = !!c.consultation?.scheduled_at;
  const hoursUntilAppt = isScheduled ? (new Date(c.consultation.scheduled_at) - new Date()) / (1000 * 60 * 60) : null;
  const isMoreThan24h = hoursUntilAppt === null || hoursUntilAppt > 24;
  const isWorsening = cancelReason === 'Worsening Symptoms / Medical Emergency';

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{c.case_number}</h1>
        <button className="no-print" onClick={reload}>{t('refresh')}</button>
      </div>
      <p className="muted">{t('serviceType')}: {typeLabel}{subLabel ? ` / ${subLabel}` : ''} · {t('created')}: {fmtDate(c.created_at)}</p>
      
      {/* DEC-070: Courier-Style Stepper at top of Case View */}
      <CaseStepper workflow={c.workflow} status={c.status} />

      <section className="box">
        {/* DEC-032: SERVICE cases have no medical report — never promise one. */}
        <strong>{t('nextStep')}:</strong> {c.service_type === 'SERVICE' && c.status === 'COMPLETED' ? t('serviceCompleted') : c.next_step}
      </section>

      {/* WP4: Patient Self-Service Cancellation */}
      {canCancel && (
        <section className="box no-print" style={{ borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, color: '#991b1b', fontSize: '1rem' }}>
                {lang === 'ar' ? 'إلغاء الموعد أو الطلب' : 'Cancel Appointment / Case'}
              </h3>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                {isScheduled
                  ? (hoursUntilAppt > 24
                    ? (lang === 'ar' ? 'متبقي أكثر من 24 ساعة: يحق لك استرداد الرسوم وإعادة فتح الموعد.' : 'More than 24 hours until appointment: 100% refund eligible and slot released.')
                    : (lang === 'ar' ? 'متبقي أقل من 24 ساعة على الموعد: تنطبق سياسة الإلغاء المتأخر.' : 'Within 24-hour cutoff: Late cancellation policy applies.'))
                  : (lang === 'ar' ? 'يمكنك إلغاء هذا الطلب قبل بدء المراجعة الطبية.' : 'You can cancel this case before clinical processing is completed.')}
              </p>
            </div>
            {!cancelOpen && (
              <button
                onClick={() => setCancelOpen(true)}
                style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c', fontWeight: 600 }}
              >
                {lang === 'ar' ? 'إلغاء الموعد' : 'Cancel Case'}
              </button>
            )}
          </div>

          {cancelOpen && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #fee2e2' }}>
              <Msg err={cancelErr} />
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>
                  {lang === 'ar' ? 'سبب الإلغاء:' : 'Reason for Cancellation:'}
                </label>
                <select
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  style={{ width: '100%', maxWidth: 420 }}
                >
                  <option value="Schedule Conflict">Schedule Conflict / تعارض في المواعيد</option>
                  <option value="Found Alternate Care / Provider">Found Alternate Care / الحصول على رعاية بديلة</option>
                  <option value="Condition Improved">Condition Improved / تحسن الحالة الصحية</option>
                  <option value="Worsening Symptoms / Medical Emergency">🚨 Worsening Symptoms / Medical Emergency (تدهور الأعراض / طوارئ)</option>
                  <option value="Other">Other Reason / سبب آخر</option>
                </select>
              </div>

              {isWorsening && (
                <div style={{ background: '#fef2f2', border: '2px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: '8px', marginBottom: 12 }}>
                  <strong>🚨 {lang === 'ar' ? 'تنبيه طوارئ حاد' : 'URGENT SAFETY ALERT'}:</strong>
                  <p style={{ margin: '4px 0 8px', fontSize: '0.88rem' }}>
                    {lang === 'ar'
                      ? 'إذا كانت حالتك تسوء أو تعاني من أعراض حرجة، يرجى الاتصال فوراً بالإسعاف 997 أو التوجه لأقرب طوارئ.'
                      : 'If you are experiencing severe, acute, or worsening medical symptoms, immediately call 997 (Saudi Red Crescent) or proceed to the nearest emergency department.'}
                  </p>
                  <a
                    href="tel:997"
                    style={{
                      background: '#dc2626',
                      color: '#fff',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      textDecoration: 'none',
                      display: 'inline-block',
                      fontSize: '0.88rem'
                    }}
                  >
                    📞 Call 997 Immediately
                  </a>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'ملاحظة إضافية (اختياري)...' : 'Additional details (optional)...'}
                  value={cancelDetail}
                  onChange={e => setCancelDetail(e.target.value)}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              </div>

              <div className="row" style={{ gap: 8 }}>
                <button
                  onClick={doCancelCase}
                  disabled={cancelBusy}
                  style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff', fontWeight: 600 }}
                >
                  {cancelBusy ? t('loading') : (lang === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancellation')}
                </button>
                <button
                  onClick={() => setCancelOpen(false)}
                  className="btn"
                  disabled={cancelBusy}
                >
                  {lang === 'ar' ? 'تراجع' : 'Keep Case'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {c.document_request_note && (
        <section className="box">
          <strong>{t('docsRequested')}</strong>
          <p>{c.document_request_note}</p>
        </section>
      )}

      {c.consultation && (
        <section className="box">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{t('scheduledFor')}</h2>
            {c.consultation.meet_url && (
              <span className="badge" style={{ background: '#0284c7', color: '#fff', fontSize: '0.85rem', padding: '4px 8px', borderRadius: '4px' }}>
                🌐 {lang === 'ar' ? 'استشارة مرئية مشتركة مع مختص دولي' : 'Joint Teleconsultation with Global Specialist'}
              </span>
            )}
          </div>
          <p>{fmtDate(c.consultation.scheduled_at)} · {c.consultation.consultation_type === 'ONLINE' ? t('online') : t('inPerson')}
            {c.consultation.doctor_name ? ` · ${t('consultationWith')} ${c.consultation.doctor_name}` : ''}</p>
          {c.consultation.consultation_type === 'IN_PERSON' && c.consultation.clinic_name && (
            <p>{c.consultation.clinic_name}{c.consultation.clinic_address ? ` — ${c.consultation.clinic_address}` : ''}</p>
          )}
          {c.consultation.meet_url ? (
            <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong style={{ color: '#166534', display: 'block' }}>
                  🎥 {lang === 'ar' ? 'غرفة الاستشارة المرئية المباشرة (Google Meet)' : 'Live Video Consultation Room (Google Meet)'}
                </strong>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {c.consultation.joinable
                    ? (lang === 'ar' ? 'الجلسة متاحة الآن. اضغط للانضمام' : 'Session is active now. Click to join')
                    : (lang === 'ar' ? 'رابط الدخول جاهز' : 'Room is ready for your scheduled slot')}
                </span>
              </div>
              <a
                className="btn"
                href={c.consultation.meet_url}
                target="_blank"
                rel="noreferrer"
                style={{ background: '#16a34a', color: '#fff', fontWeight: 700, padding: '10px 20px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                🎥 {lang === 'ar' ? 'انضم للمقابلة الآن' : 'Join Video Consultation Room →'}
              </a>
            </div>
          ) : <p className="muted">{t('waitingRoom')}</p>}
        </section>
      )}

      {/* DEC-032/036 / DEC-062: downloadable PDF report for patients */}
      {c.service_type !== 'SERVICE' && c.status !== 'CANCELLED' && (
        <section className="box">
          <h2>{t('report')}</h2>
          {(c.report_released || c.final_report_published) && (c.report || c.final_report_en) ? (
            <>
              <pre className="report">{c.report || c.final_report_en}</pre>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="no-print" onClick={() => window.print()}>{t('print')}</button>
                <a
                  className="btn no-print"
                  href={`/api/v1/cases/${c.id}/report/pdf`}
                  download={`Medical_Report_${c.case_number}.pdf`}
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Download PDF Report
                </a>
              </div>
            </>
          ) : <p className="muted">{t('reportPending')}</p>}
        </section>
      )}

      {c.report_released && !!c.prescriptions?.length && (
        <section className="box">
          <h2>{t('prescriptions')}</h2>
          <table>
            <thead><tr><th>{t('drugName')}</th><th>{t('dosage')}</th><th>{t('frequency')}</th><th>{t('duration')}</th><th>{t('route')}</th></tr></thead>
            <tbody>
              {c.prescriptions.map(rx => (
                <tr key={rx.id}><td>{rx.drug_name}</td><td>{rx.dosage || '—'}</td><td>{rx.frequency || '—'}</td><td>{rx.duration || '—'}</td><td>{rx.route || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="box">
        <h2>{t('documents')}</h2>
        <DocumentList caseId={c.id} documents={c.documents} />
        {c.status !== 'CANCELLED' && <FileUploader caseId={c.id} onUploaded={reload} />}
      </section>

      <section className="box">
        <h2>{t('timeline')}</h2>
        <Timeline events={c.timeline} />
      </section>

      <div className="row no-print">
        {c.can_follow_up && <Link className="btn" to={`/book?type=CONSULTATION&parent=${c.id}`}>{t('requestFollowUp')}</Link>}
        {c.can_request_service && <Link className="btn" to={`/book?type=SERVICE&parent=${c.id}`}>{t('requestService')}</Link>}
        <Link className="btn" to="/cases">{t('back')}</Link>
      </div>
    </div>
  );
}