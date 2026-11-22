// DEC-056 / DEC-063: Patient Mobile Live Queue Status Page (/p/:code) with SSE & Vibration
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg } from '../../components/ui';
import { NativeBridge } from '../../lib/nativeBridge';

function alertPatient(code) {
  try {
    NativeBridge.notifyTicketCalled({ code, status: 'in_clinic' });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    }
  } catch (e) {}
}

export default function PatientTracker() {
  const { code } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const prevStatusRef = useRef(null);

  const handleUpdate = (fresh) => {
    if (!fresh) return;
    setData(fresh);
    const newStatus = fresh.case?.arrival_status;
    if ((fresh.just_called || (newStatus === 'in_clinic' && prevStatusRef.current !== 'in_clinic')) && prevStatusRef.current !== null) {
      alertPatient(code);
    }
    prevStatusRef.current = newStatus;
  };

  const fetchStatus = () => {
    api.get(`/public/case/${code}`)
      .then(r => handleUpdate(r.data))
      .catch(e => setErr(errMsg(e) || 'Case not found'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();

    // SSE real-time stream
    let es = null;
    try {
      es = new EventSource(`/api/v1/public/case/${code}/stream`);
      es.onopen = () => setIsLive(true);
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          handleUpdate(parsed);
          setIsLive(true);
        } catch (err) {}
      };
      es.onerror = () => setIsLive(false);
    } catch (e) {
      setIsLive(false);
    }

    const iv = setInterval(fetchStatus, 15_000);
    return () => {
      clearInterval(iv);
      if (es) es.close();
    };
  }, [code]);

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ letterSpacing: 2 }}>{t('app')}</strong>
        {isLive && (
          <span style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #000', borderRadius: 10, fontWeight: 700 }}>
            ● LIVE
          </span>
        )}
      </div>
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

        {c.arrival_status === 'in_clinic' && (
          <div style={{ background: '#000', color: '#fff', padding: 16, textAlign: 'center', margin: '16px 0', border: '2px solid #000' }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>🔔 YOU HAVE BEEN CALLED!</div>
            <p style={{ margin: '6px 0 0', opacity: 0.9 }}>Please proceed immediately to the doctor's clinic room.</p>
          </div>
        )}

        {c.queue_number ? (
          <div style={{ textAlign: 'center', margin: '20px 0', border: '3px solid #000', padding: 20 }}>
            <div className="muted">{t('queueNumber')}</div>
            <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: 4 }}>
              {c.queue_number}
            </div>
            <div className="badge" style={{ marginTop: 8 }}>
              {c.arrival_status === 'in_clinic' ? 'In Consultation with Doctor' : c.arrival_status === 'arrived' ? 'Waiting in Clinic' : c.arrival_status}
            </div>
            {queue.estimated_wait_min > 0 && c.arrival_status === 'arrived' && (
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
          <p><strong>Doctor:</strong> {data.doctor?.full_name ? `Dr. ${data.doctor.full_name}` : 'Attending Physician'}</p>
          <p className="muted">Case: {c.case_number} · Specialty: {c.requested_specialty || data.doctor?.specialty || 'General'}</p>
        </div>

        {/* Download PDF Visit Summary if consultation is resulted */}
        {(c.status === 'completed' || c.doctor_opinion) && (
          <div style={{ marginTop: 16, borderTop: '1px solid #000', paddingTop: 12 }}>
            <p><strong>Visit Summary Available</strong></p>
            <a
              className="btn"
              href={`/api/v1/public/case/${c.checkin_code}/report/pdf`}
              download={`Clinic_Visit_${c.case_number}.pdf`}
              style={{ textDecoration: 'none', display: 'inline-block', width: '100%', textAlign: 'center', boxSizing: 'border-box' }}
            >
              📄 Download Clinic Visit Summary (PDF)
            </a>
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={fetchStatus}>{t('refresh')}</button>
        </div>
      </section>
    </div>
  );
}
