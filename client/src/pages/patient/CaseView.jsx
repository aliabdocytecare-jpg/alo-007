// US-PAT-009/010/011/012/013 — unified patient case view.
// BR-016 patient-facing labels only; BR-023 Meet window; BR-015 release gating.
import { useParams, Link } from 'react-router-dom';
import { api, fmtDate } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, StatusBadge, Timeline, DocumentList, FileUploader, useAsync } from '../../components/ui';

export default function CaseView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { data: c, err, loading, reload } = useAsync(() => api.get(`/cases/${id}?lang=${lang}`).then(r => r.data), [id, lang]);
  const { data: catalog } = useAsync(() => api.get('/catalog').then(r => r.data));

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

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{c.case_number}</h1>
        <button className="no-print" onClick={reload}>{t('refresh')}</button>
      </div>
      <p className="muted">{t('serviceType')}: {typeLabel}{subLabel ? ` / ${subLabel}` : ''} · {t('created')}: {fmtDate(c.created_at)}</p>
      <p><StatusBadge status={c.status} /></p>

      <section className="box">
        {/* DEC-032: SERVICE cases have no medical report — never promise one. */}
        <strong>{t('nextStep')}:</strong> {c.service_type === 'SERVICE' && c.status === 'COMPLETED' ? t('serviceCompleted') : c.next_step}
      </section>

      {c.document_request_note && (
        <section className="box">
          <strong>{t('docsRequested')}</strong>
          <p>{c.document_request_note}</p>
        </section>
      )}

      {c.consultation && (
        <section className="box">
          <h2>{t('scheduledFor')}</h2>
          <p>{fmtDate(c.consultation.scheduled_at)} · {c.consultation.consultation_type === 'ONLINE' ? t('online') : t('inPerson')}
            {c.consultation.doctor_name ? ` · ${t('consultationWith')} ${c.consultation.doctor_name}` : ''}</p>
          {c.consultation.consultation_type === 'IN_PERSON' && c.consultation.clinic_name && (
            <p>{c.consultation.clinic_name}{c.consultation.clinic_address ? ` — ${c.consultation.clinic_address}` : ''}</p>
          )}
          {c.consultation.meet_url
            ? (c.consultation.joinable
              ? <a className="btn" href={c.consultation.meet_url} target="_blank" rel="noreferrer">{t('join')} →</a>
              : <p>{t('meetLink')}: <a href={c.consultation.meet_url} target="_blank" rel="noreferrer">{c.consultation.meet_url}</a></p>)
            : <p className="muted">{t('waitingRoom')}</p>}
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