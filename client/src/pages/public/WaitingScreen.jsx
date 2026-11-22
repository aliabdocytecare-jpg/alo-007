// DEC-056: Fullscreen Waiting Room TV Display Feed
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

export default function WaitingScreen() {
  const { pin } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [timeStr, setTimeStr] = useState('');

  const activePin = pin || localStorage.getItem('alodoc_kiosk_pin') || '123456';

  const pollFeed = () => {
    api.get(`/public/screen/${activePin}/waiting`)
      .then(r => setData(r.data))
      .catch(() => {});
  };

  useEffect(() => {
    pollFeed();
    const iv = setInterval(pollFeed, 10_000);
    return () => clearInterval(iv);
  }, [activePin]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateClock();
    const clk = setInterval(updateClock, 1000);
    return () => clearInterval(clk);
  }, []);

  const calling = data?.now_calling || [];
  const waiting = data?.waiting_queue || [];

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#000', padding: 24, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000', paddingBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: 2 }}>{data?.hospital_name || 'ALODOC CLINIC'}</h1>
          <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 16 }}>{data?.city || 'Day-Clinic Services'}</p>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace' }}>{timeStr}</div>
          <button onClick={toggle} style={{ marginTop: 4 }}>{t('language')}</button>
        </div>
      </header>

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, marginTop: 24 }}>
        {/* Left Column: NOW CALLING */}
        <section style={{ border: '3px solid #000', padding: 24 }}>
          <h2 style={{ fontSize: 24, margin: '0 0 16px 0', borderBottom: '2px solid #000', paddingBottom: 8 }}>
            {t('nowCalling')}
          </h2>
          {!calling.length && (
            <p className="muted" style={{ fontSize: 20, textAlign: 'center', margin: '40px 0' }}>
              No patients currently called. Please wait for your number.
            </p>
          )}
          {calling.map((c, i) => (
            <div key={i} style={{ border: '2px solid #000', padding: 20, marginBottom: 16, background: '#000', color: '#fff' }}>
              <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: 4 }}>
                {c.queue_number}
              </div>
              <div style={{ fontSize: 22, marginTop: 8, opacity: 0.9 }}>
                {c.doctor_name || 'Consultation Clinic'}
              </div>
            </div>
          ))}
        </section>

        {/* Right Column: WAITING QUEUE */}
        <section style={{ border: '3px solid #000', padding: 24 }}>
          <h2 style={{ fontSize: 24, margin: '0 0 16px 0', borderBottom: '2px solid #000', paddingBottom: 8 }}>
            {t('waitingQueue')} ({waiting.length})
          </h2>
          {!waiting.length && (
            <p className="muted" style={{ fontSize: 18, textAlign: 'center', margin: '40px 0' }}>
              {t('noItems')}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 }}>
            {waiting.map((w, i) => (
              <div key={i} style={{ border: '2px solid #000', padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 32, fontWeight: 800 }}>{w.queue_number}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>~{w.estimated_wait_min}m</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '2px solid #000', marginTop: 24, paddingTop: 12, textAlign: 'center', fontSize: 14 }}>
        <p className="muted">Please proceed to your assigned room immediately when your number is called. / يرجى التوجه إلى عيادتك فور ظهور رقمك.</p>
      </footer>
    </div>
  );
}
