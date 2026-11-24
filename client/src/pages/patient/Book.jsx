// US-PAT-005/006/007/012/013 — consultation booking, GMO submission, service request.
// P4: profile pre-filled, never re-entered. BR-012: parent_case_id for follow-ups/related services.
// DEC-008: preferred datetime captured; coordinator confirms the slot when scheduling.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Msg, Field } from '../../components/ui';

const PURPOSES = [
  ['Diagnosis Confirmation', 'purposeDiagnosis'], ['Treatment Plan Review', 'purposeTreatment'],
  ['Surgery Assessment', 'purposeSurgery'], ['Treatment Options Review', 'purposeOptions'],
  ['Complex Case Review', 'purposeComplex'], ['Additional / Second Opinion', 'purposeSecond']
];

export default function Book() {
  const [params] = useSearchParams();
  const type = params.get('type') || 'CONSULTATION';
  const parentId = params.get('parent') || null;
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const p = session?.profile || {};

  const [catalog, setCatalog] = useState(null);
  const [parent, setParent] = useState(null);
  const [subtype, setSubtype] = useState(parentId ? 'FOLLOW_UP' : 'ONLINE');
  const [specialty, setSpecialty] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [preferred, setPreferred] = useState('');
  const [purpose, setPurpose] = useState('');
  const [serviceCode, setServiceCode] = useState('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState({ symptoms: '', medications: '', allergies: '', diagnosis: '' });
  const [consent, setConsent] = useState(false);
  const [emergencyFlagged, setEmergencyFlagged] = useState(false);
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    api.get('/catalog').then(r => setCatalog(r.data)).catch(e => setErr(errMsg(e)));
    if (parentId) {
      api.get(`/cases/${parentId}`).then(r => {
        const c = r.data;
        setParent(c);
        if (c.specialty) setSpecialty(c.specialty);
        if (c.reason) setReason(type === 'CONSULTATION' ? `Follow-up: ${c.reason}` : '');
        if (c.history) setHistory(h => ({ ...h, ...c.history }));
      }).catch(() => {});
    }
  }, [parentId, type]);

  // Pre-fill doctor from parent consultation once catalog arrives.
  useEffect(() => {
    if (parent?.consultation?.doctor_name && catalog?.doctors) {
      const d = catalog.doctors.find(x => x.full_name === parent.consultation.doctor_name);
      if (d) setDoctorId(d.id);
    }
  }, [parent, catalog]);

  const doctors = (catalog?.doctors || []).filter(d => !specialty || d.specialty === specialty);
  const liveServices = (catalog?.services || []).filter(s => s.is_active);

  const submit = async () => {
    setErr('');
    if (emergencyFlagged) return setErr(lang === 'ar' ? 'لا يمكن إتمام الحجز للحالات الطارئة. يرجى الاتصال بـ 997 فوراً.' : 'Online booking suspended for acute emergencies. Call 997 immediately.');
    if (!reason.trim()) return setErr(t('reason') + ' — ' + t('submit'));
    if (type === 'GMO' && !purpose) return setErr(t('purpose'));
    if (type === 'GMO' && !consent) return setErr(t('consent'));
    if (type === 'SERVICE' && !serviceCode) return setErr(t('selectService'));
    setBusy(true);
    try {
      const body = {
        service_type: type,
        service_subtype: type === 'CONSULTATION' ? subtype : type === 'SERVICE' ? serviceCode : null,
        specialty: specialty || null,
        purpose: type === 'GMO' ? purpose : null,
        reason,
        history: { ...history, preferred_time: preferred || undefined, preferred_doctor_id: doctorId || undefined },
        parent_case_id: parentId
      };
      const { data: created } = await api.post('/cases', body);
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('category', 'Medical Report');
        await api.post(`/cases/${created.id}/documents`, fd);
      }
      setDone(created);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  if (done) {
    return (
      <div>
        <h1>{t('caseCreated')}</h1>
        <section className="box">
          <p><strong>{t('caseId')}: {done.case_number}</strong></p>
          <h2>{t('paymentTitle')}</h2>
          <p>{catalog?.settings?.[`payment_instructions_${lang}`] || catalog?.settings?.payment_instructions_en}</p>
          <div className="row">
            <Link className="btn" to={`/cases/${done.id}`}>{t('view')} →</Link>
            <Link className="btn" to="/cases">{t('myCases')}</Link>
          </div>
        </section>
      </div>
    );
  }

  const title = type === 'CONSULTATION' ? t('bookFlow') : type === 'GMO' ? t('gmoFlow') : t('serviceFlow');

  return (
    <div>
      <h1>{title}{parent ? ` — ${t('parentCase')}: ${parent.case_number}` : ''}</h1>
      <Msg err={err} />
      <section className="box">
        <h2>{t('patientInfo')} ({t('profile')})</h2>
        <p className="muted">{p.full_name} · {p.phone} · {p.dob || '—'} · {p.gender === 'FEMALE' ? t('female') : p.gender === 'MALE' ? t('male') : '—'} · {p.nationality || '—'}</p>
      </section>

      <section className="box">
        {type === 'CONSULTATION' && (
          <>
            <Field label={t('consultationType')}>
              <select value={subtype} onChange={e => setSubtype(e.target.value)}>
                <option value="ONLINE">{t('online')}</option>
                <option value="IN_PERSON">{t('inPerson')}</option>
                {parentId && <option value="FOLLOW_UP">{t('followUp')}</option>}
              </select>
            </Field>
            <Field label={t('specialty')}>
              <select value={specialty} onChange={e => { setSpecialty(e.target.value); setDoctorId(''); }}>
                <option value="">{t('selectSpecialty')}</option>
                {(catalog?.specialties || []).map(s => <option key={s.id} value={s.name_en}>{lang === 'ar' && s.name_ar ? s.name_ar : s.name_en}</option>)}
              </select>
            </Field>
            <Field label={t('doctor')}>
              <select value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">{t('selectDoctor')}</option>
                {doctors.map(d => {
                  const sameName = doctors.filter(x => x.full_name === d.full_name).length > 1;
                  return <option key={d.id} value={d.id}>{d.full_name} — {d.specialty}{sameName ? ` · ${d.id.slice(0, 4)}` : ''}</option>;
                })}
              </select>
            </Field>
            {!doctors.length && specialty && <p className="muted">{t('noDoctor')}</p>}
            <Field label={t('appointmentTime')}>
              <input type="datetime-local" value={preferred} onChange={e => setPreferred(e.target.value)} />
            </Field>
          </>
        )}

        {type === 'GMO' && (
          <>
            <Field label={t('specialty')}>
              <select value={specialty} onChange={e => setSpecialty(e.target.value)}>
                <option value="">{t('selectSpecialty')}</option>
                {(catalog?.specialties || []).map(s => <option key={s.id} value={s.name_en}>{lang === 'ar' && s.name_ar ? s.name_ar : s.name_en}</option>)}
              </select>
            </Field>
            <Field label={t('purpose')}>
              <select value={purpose} onChange={e => setPurpose(e.target.value)}>
                <option value="">—</option>
                {PURPOSES.map(([val, key]) => <option key={val} value={val}>{t(key)}</option>)}
              </select>
            </Field>
          </>
        )}

        {type === 'SERVICE' && (
          <Field label={t('selectService')}>
            <select value={serviceCode} onChange={e => setServiceCode(e.target.value)}>
              <option value="">—</option>
              {(catalog?.services || []).map(s => (
                <option key={s.id} value={s.code} disabled={!s.is_active}>
                  {lang === 'ar' && s.name_ar ? s.name_ar : s.name_en}{s.coming_soon && !s.is_active ? ` (${t('comingSoon')})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t('reason')}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} />
        </Field>

        {type !== 'SERVICE' && (
          <>
            <h2>{t('historyTitle')}</h2>
            <div className="grid2">
              <Field label={t('symptoms')}><input value={history.symptoms} onChange={e => setHistory({ ...history, symptoms: e.target.value })} /></Field>
              <Field label={t('medications')}><input value={history.medications} onChange={e => setHistory({ ...history, medications: e.target.value })} /></Field>
              <Field label={t('allergies')}><input value={history.allergies} onChange={e => setHistory({ ...history, allergies: e.target.value })} /></Field>
              <Field label={t('diagnosis')}><input value={history.diagnosis} onChange={e => setHistory({ ...history, diagnosis: e.target.value })} /></Field>
            </div>
          </>
        )}

        <h2>{type === 'GMO' ? t('files') : t('optionalFiles')}</h2>
        <input id="book-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx" style={{ display: 'none' }}
          onChange={e => setFiles(Array.from(e.target.files || []))} />
        <label className="btn" htmlFor="book-files">{t('chooseFiles')}</label>
        <span className="muted"> {files.length ? '' : t('noFileChosen')}</span>
        {files.length > 0 && (
          <table>
            <tbody>
              {files.map((f, i) => (
                <tr key={i}><td>{f.name}</td><td>{Math.round(f.size / 1024)} KB</td>
                  <td><button onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></td></tr>
              ))}
            </tbody>
          </table>
        )}

        {type === 'GMO' && (
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {t('consent')}
          </label>
        )}

        {/* WP4: Emergency 997 Safety Gate */}
        <div style={{ background: emergencyFlagged ? '#fef2f2' : '#f8fafc', border: `2px solid ${emergencyFlagged ? '#ef4444' : '#e2e8f0'}`, borderRadius: '8px', padding: '14px', marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ fontSize: '1.6rem' }}>🚨</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#991b1b', display: 'block', fontSize: '0.98rem' }}>
                {lang === 'ar' ? 'تنبيه السلامة الطبي — خدمات غير طارئة' : 'Clinical Safety Notice — Non-Emergent Services Only'}
              </strong>
              <p style={{ margin: '4px 0 8px', fontSize: '0.88rem', color: '#475569' }}>
                {lang === 'ar'
                  ? 'منصة ألو دكتور مخصصة للاستشارات المجدولة والآراء الطبية الثانية. إذا كنت أنت أو المريض تعاني من ألم حاد في الصدر، ضيق تنفس حاد، أعراض سكتة، أو نزيف شديد:'
                  : 'AloDoc provides scheduled outpatient consultations and expert written opinions. If you or the patient are experiencing acute chest pain, severe shortness of breath, sudden stroke symptoms, or heavy bleeding:'}
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <a
                  href="tel:997"
                  style={{
                    background: '#dc2626',
                    color: '#fff',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontSize: '0.9rem'
                  }}
                >
                  📞 {lang === 'ar' ? 'اتصل بـ 997 (الهلال الأحمر)' : 'Call 997 Immediately'}
                </a>
              </div>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: '0.88rem', fontWeight: 600, color: '#991b1b', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={emergencyFlagged}
              onChange={e => setEmergencyFlagged(e.target.checked)}
            />
            <span>
              {lang === 'ar'
                ? 'أعاني حالياً من حالة طبية طارئة حادة / ألم شديد'
                : 'I am experiencing an acute medical emergency / severe symptoms'}
            </span>
          </label>
        </div>

        {emergencyFlagged && (
          <div style={{ background: '#7f1d1d', color: '#fff', padding: '14px', borderRadius: '8px', marginTop: 12, textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 6px', color: '#fef08a' }}>🛑 {lang === 'ar' ? 'تم إيقاف الحجز للحالات الطارئة' : 'BOOKING HALTED: Call 997 Immediately'}</h3>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              {lang === 'ar'
                ? 'سلامتك هي أولويتنا. يرجى الاتصال بالإسعاف (997) أو التوجه فوراً لأقرب قسم طوارئ.'
                : 'For your safety, booking is suspended. Please contact the Saudi Red Crescent (997) or go to the nearest emergency department right now.'}
            </p>
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={submit} disabled={busy || emergencyFlagged}>{busy ? t('loading') : t('reviewAndSubmit')}</button>
          <Link className="btn" to="/">{t('cancel')}</Link>
        </div>
      </section>
    </div>
  );
}