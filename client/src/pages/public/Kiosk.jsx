// DEC-056: Kiosk Self-Service Check-In Tablet Interface
import { useState, useEffect } from 'react';
import { api, errMsg } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg } from '../../components/ui';

export default function Kiosk() {
  const { t, toggle } = useI18n();
  const [pin, setPin] = useState(localStorage.getItem('alodoc_kiosk_pin') || '');
  const [paired, setPaired] = useState(false);
  const [hospital, setHospital] = useState(null);
  const [code, setCode] = useState('');
  const [slip, setSlip] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetTimer, setResetTimer] = useState(15);

  // Auto-reset slip screen after 15s to protect patient privacy for the next person in line
  useEffect(() => {
    if (!slip) {
      setResetTimer(15);
      return;
    }
    const iv = setInterval(() => {
      setResetTimer(prev => {
        if (prev <= 1) {
          setSlip(null);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [slip]);

  useEffect(() => {
    if (pin && pin.length >= 4) {
      api.get(`/public/kiosk/${pin}`)
        .then(r => {
          setHospital(r.data.hospital);
          setPaired(true);
          localStorage.setItem('alodoc_kiosk_pin', pin);
        })
        .catch(() => setPaired(false));
    }
  }, [pin]);

  const doPair = async (e) => {
    e?.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const { data } = await api.get(`/public/kiosk/${pin}`);
      setHospital(data.hospital);
      setPaired(true);
      localStorage.setItem('alodoc_kiosk_pin', pin);
    } catch (e) {
      setErr(errMsg(e) || 'Invalid Kiosk PIN');
    } finally {
      setBusy(false);
    }
  };

  const doCheckin = async (e) => {
    e?.preventDefault();
    setErr('');
    if (!code || code.trim().length !== 6) {
      return setErr(t('enterCode'));
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/public/kiosk/${pin}/checkin`, { checkin_code: code.trim().toUpperCase() });
      setSlip(data);
      setCode('');
    } catch (e) {
      setErr(errMsg(e) || 'Case not found for this code or already completed');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="row" style={{ justifyContent: 'space-between', borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 16 }}>
      <strong style={{ letterSpacing: 2, fontSize: 18 }}>{hospital?.name || t('kiosk')}</strong>
      <button onClick={toggle}>{t('language')}</button>
    </div>
  );

  if (!paired) {
    return (
      <div className="wrap" style={{ maxWidth: 480, marginTop: 40 }}>
        {header}
        <section className="box">
          <h2>Pair Kiosk Tablet</h2>
          <p className="muted">Enter the 6-digit hospital kiosk PIN to activate this check-in tablet.</p>
          <Msg err={err} />
          <form onSubmit={doPair}>
            <input
              type="password"
              maxLength={6}
              placeholder="e.g. 123456"
              value={pin}
              onChange={e => setPin(e.target.value)}
              style={{ fontSize: 24, textAlign: 'center', letterSpacing: 6, margin: '12px 0' }}
            />
            <button type="submit" disabled={busy || pin.length < 4} style={{ width: '100%', padding: 12 }}>
              {busy ? t('loading') : 'Pair Tablet'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  if (slip) {
    return (
      <div className="wrap" style={{ maxWidth: 520, marginTop: 30 }}>
        {header}
        <section className="box" style={{ textAlign: 'center', padding: 24 }}>
          <h2>{t('queueSlip')}</h2>
          <p className="muted">{hospital?.name} · {hospital?.city}</p>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: 4, margin: '20px 0', border: '3px solid #000', padding: 16 }}>
            {slip.queue_number}
          </div>
          <p><strong>{slip.patient_name}</strong></p>
          <p className="muted">{t('clinicRoom')}: {slip.doctor_name || 'Assigned Consultation'}</p>
          <p className="muted">{t('estimatedWait')}: ~{slip.estimated_wait_min} {t('minutes')}</p>
          <p style={{ marginTop: 20 }}>
            <span className="badge">Code: {slip.checkin_code}</span>
          </p>
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
            Screen will automatically reset for the next patient in <strong>{resetTimer}s</strong>
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button onClick={() => window.print()} className="btn">{t('print')}</button>
            <button onClick={() => setSlip(null)}>Finish / Done</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 520, marginTop: 30 }}>
      {header}
      <section className="box" style={{ textAlign: 'center', padding: 24 }}>
        <h1>{t('kiosk')}</h1>
        <p className="muted">{t('kioskDesc')}</p>
        <Msg err={err} />
        <form onSubmit={doCheckin} style={{ marginTop: 20 }}>
          <input
            type="text"
            maxLength={6}
            placeholder="ABC789"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            style={{ fontSize: 32, textAlign: 'center', letterSpacing: 8, textTransform: 'uppercase', padding: 12, margin: '16px 0' }}
          />
          <button type="submit" disabled={busy || code.trim().length !== 6} style={{ width: '100%', padding: 14, fontSize: 16, fontWeight: 700 }}>
            {busy ? t('loading') : t('checkinBtn')}
          </button>
        </form>
        <div style={{ marginTop: 24 }}>
          <button className="btn" onClick={() => { setPaired(false); localStorage.removeItem('alodoc_kiosk_pin'); }}>
            Reset Kiosk PIN
          </button>
        </div>
      </section>
    </div>
  );
}
