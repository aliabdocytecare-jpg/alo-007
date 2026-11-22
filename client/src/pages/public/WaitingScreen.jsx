// DEC-056 / DEC-062: Real-Time Fullscreen Waiting Room TV Display Feed with Instant SSE & Web Audio Chime
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

function playAirportChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (C5 - 523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);

    // Second tone (E5 - 659.25 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now + 0.22);
    gain2.gain.setValueAtTime(0.25, now + 0.22);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.22);
    osc2.stop(now + 0.75);
  } catch (err) {
    // AudioContext blocked without user interaction; fail silently
  }
}

export default function WaitingScreen() {
  const { pin } = useParams();
  const { t, toggle } = useI18n();
  const [data, setData] = useState(null);
  const [timeStr, setTimeStr] = useState('');
  const [isLive, setIsLive] = useState(false);
  const prevCallingRef = useRef([]);

  const activePin = pin || localStorage.getItem('alodoc_kiosk_pin') || '123456';

  const handleNewData = (fresh) => {
    if (!fresh) return;
    setData(fresh);

    const freshCalling = (fresh.now_calling || fresh.calling || []).map(c => c.queue_number);
    const prevCalling = prevCallingRef.current;

    // Check if new ticket was called
    const hasNewTicket = freshCalling.some(num => !prevCalling.includes(num));
    if (fresh.just_called || hasNewTicket) {
      playAirportChime();
    }
    prevCallingRef.current = freshCalling;
  };

  const pollFeed = () => {
    api.get(`/public/screen/${activePin}/waiting`)
      .then(r => handleNewData(r.data))
      .catch(() => {});
  };

  useEffect(() => {
    pollFeed();

    // Setup real-time Server-Sent Events (SSE)
    let es = null;
    try {
      es = new EventSource(`/api/v1/public/screen/${activePin}/waiting/stream`);
      es.onopen = () => setIsLive(true);
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          handleNewData(parsed);
          setIsLive(true);
        } catch (err) {}
      };
      es.onerror = () => {
        setIsLive(false);
      };
    } catch (e) {
      setIsLive(false);
    }

    // Interval fallback in case of connection drop
    const iv = setInterval(pollFeed, 15_000);

    return () => {
      clearInterval(iv);
      if (es) es.close();
    };
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

  const calling = data?.now_calling || data?.calling || [];
  const waiting = data?.waiting_queue || data?.waiting || [];

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#000', padding: 24, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 32, letterSpacing: 2 }}>{data?.hospital_name || data?.hospital?.name || 'ALODOC CLINIC'}</h1>
            {isLive && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 8px', border: '1px solid #000', borderRadius: 12, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#000' }} />
                REAL-TIME
              </span>
            )}
          </div>
          <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 16 }}>{data?.city || data?.hospital?.city || 'Day-Clinic Services'}</p>
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
