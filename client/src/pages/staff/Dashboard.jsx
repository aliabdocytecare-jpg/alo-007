// US-CRD-001 (segmented queues), US-NUR-001/005 (assigned only, due/overdue),
// US-DOC-001 (today's appointments + assigned cases). BR-004/005 scoping is server-side.
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, StatusBadge, useAsync } from '../../components/ui';

const isOverdue = c => c.sla_due_at && new Date(c.sla_due_at) < new Date() && !['COMPLETED', 'CANCELLED', 'FOLLOW_UP'].includes(c.status);
const overdueLabel = c => {
  const mins = Math.round((Date.now() - new Date(c.sla_due_at).getTime()) / 60_000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
};
const isToday = d => d && new Date(d).toDateString() === new Date().toDateString();

function CaseTable({ rows }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="muted">{t('noItems')}</p>;
  return (
    <table>
      <thead><tr><th>{t('caseId')}</th><th>{t('patient')}</th><th>{t('type')}</th><th>{t('status')}</th><th>{t('scheduledFor')}</th><th>SLA</th><th></th></tr></thead>
      <tbody>
        {rows.map(c => (
          <tr key={c.id}>
            <td>{c.case_number}</td>
            <td>{c.patients?.full_name || '—'}</td>
            <td>{c.service_type}</td>
            <td><StatusBadge status={c.status} /></td>
            <td>{c.consultations?.scheduled_at ? fmtDate(c.consultations.scheduled_at) : '—'}</td>
            <td>{isOverdue(c) ? <strong>[{t('overdue')} +{overdueLabel(c)}]</strong> : (c.sla_due_at ? fmtDate(c.sla_due_at) : '—')}</td>
            <td><Link className="btn" to={`/staff/cases/${c.id}`}>{t('open')}</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, rows, open }) {
  return (
    <details open={open ?? rows.length > 0}>
      <summary>{title} [{rows.length}]</summary>
      <div className="inner"><CaseTable rows={rows} /></div>
    </details>
  );
}

export default function StaffDashboard() {
  const { t } = useI18n();
  const { session } = useAuth();
  const role = session?.role;
  const { data, err, loading, reload } = useAsync(() => api.get('/cases').then(r => r.data));
  const rows = data || [];

  const by = fn => rows.filter(fn);
  const overdue = by(isOverdue);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('dashboard')} — {t(role)}</h1>
        <button onClick={reload}>{t('refresh')}</button>
      </div>
      <Msg err={err} />
      {loading && <p>{t('loading')}</p>}

      {role === 'coordinator' && data && (
        <>
          <Section title={t('newCases')} rows={by(c => ['SUBMITTED', 'INITIAL_REVIEW'].includes(c.status))} />
          <Section title={t('incomplete')} rows={by(c => c.status === 'ADDITIONAL_INFO_REQUIRED')} />
          <Section title={t('unassigned')} rows={by(c => c.status === 'READY_FOR_ASSIGNMENT')} />
          <Section title={t('activeReviews')} rows={by(c => ['UNDER_MEDICAL_REVIEW', 'IN_PROGRESS'].includes(c.status))} />
          <Section title={t('upcoming')} rows={by(c => c.status === 'APPOINTMENT_SCHEDULED')} />
          <Section title={t('reportReady')} rows={by(c => c.status === 'REPORT_SUBMITTED')} />
          <Section title={t('followUps')} rows={by(c => c.status === 'FOLLOW_UP')} />
          <Section title={t('intlReviews')} rows={by(c => c.service_type === 'GMO' && ['SPECIALIST_ASSIGNED', 'UNDER_MEDICAL_REVIEW'].includes(c.status))} />
          <Section title={`${t('overdue')} [SLA]`} rows={overdue} open={overdue.length > 0} />
          <Section title={t('allCases')} rows={rows} open={false} />
        </>
      )}

      {role === 'nurse' && data && (
        <>
          <Section title={t('overdue')} rows={overdue} open={overdue.length > 0} />
          <Section title={t('dueToday')} rows={by(c => c.sla_due_at && isToday(c.sla_due_at))} />
          <Section title={t('assignedCases')} rows={rows} />
        </>
      )}

      {role === 'doctor' && data && (
        <>
          <Section title={t('todayAppointments')} rows={by(c => isToday(c.consultations?.scheduled_at))} />
          <Section title={t('assignedCases')} rows={rows} />
        </>
      )}

      {role === 'admin' && data && (
        <>
          <Section title={`${t('overdue')} [SLA]`} rows={overdue} open={overdue.length > 0} />
          <Section title={t('allCases')} rows={rows} />
          <p><Link className="btn" to="/admin">{t('admin')} →</Link></p>
        </>
      )}
    </div>
  );
}