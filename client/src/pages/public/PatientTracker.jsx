// DEC-056: Patient Mobile Live Queue Status Page (/p/:code)
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg } from '../../components/ui';

export default function PatientTracker() {
  const { code } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchStatus = () => {
    api.get(`/public/case/${code}`)
      .then(r => setData(r.data))
      .catch(e => setErr(errMsg(e) || 'Case not found'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 15_000);
    return () => clearInterval(iv);
  }, [code]);

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
      <strong style={{ letterSpacing: 2 }}>{t('app')}</strong>
      <button onClick={toggle}>{t('language')}</button>
    </div>
  );

  if (loading) return <div className="wrap" style={{ maxWidth: 500 }}>{header}<p>{t('loading')}</p></div>;

  if (err || !data) {
    return (
      <div className="wrap" style={{ maxWidth: 500 }}>
        {header}
        <section className="box">
          <Msg err={err || 'Invalid check-in code'} />
          <p className="muted">Please verify the link sent to your phone via WhatsApp or visit clinic reception.</p>
        </section>
      </div>
    );
  }

  const c = data.case || {};
  const hosp = data.hospital || {};
  const queue = data.queue || {};

  return (
    <div className="wrap" style={{ maxWidth: 500 }}>
      {header}
      <section className="box">
        <h1>{hosp.name || 'Hospital Clinic'}</h1>
        <p className="muted">{hosp.city} · Code: <strong>{c.checkin_code}</strong></p>

        {c.queue_number ? (
          <div style={{ textAlign: 'center', margin: '24px 0', border: '3px solid #000', padding: 20 }}>
            <div className="muted">{t('queueNumber')}</div>
            <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: 4 }}>
              {c.queue_number}
            </div>
            <div className="badge" style={{ marginTop: 8 }}>
              {c.arrival_status === 'in_clinic' ? 'In Consultation with Doctor' : c.arrival_status === 'arrived' ? 'Waiting in Clinic' : c.arrival_status}
            </div>
            {queue.estimated_wait_min > 0 && (
              <p className="muted" style={{ marginTop: 12 }}>
                {t('estimatedWait')}: ~{queue.estimated_wait_min} {t('minutes')} ({queue.ahead_count || 0} patient(s) ahead)
              </p>
            )}
          </div>
        ) : (
          <div style={{ margin: '20px 0', border: '1px solid #000', padding: 16 }}>
            <p><strong>Appointment Scheduled</strong></p>
            <p className="muted">Date: {c.appointment_date || 'Today'} · Time: {c.appointment_time || 'On Arrival'}</p>
            <p>Please present code <strong>{c.checkin_code}</strong> at the clinic kiosk or reception on arrival.</p>
          </div>
        )}

        <div style={{ borderTop: '1px solid #000', paddingTop: 12 }}>
          <p><strong>Patient:</strong> {c.patient_name}</p>
          <p className="muted">Case: {c.case_number} · Specialty: {c.requested_specialty || 'General'}</p>
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={fetchStatus}>{t('refresh')}</button>
        </div>
      </section>
    </div>
  );
}
