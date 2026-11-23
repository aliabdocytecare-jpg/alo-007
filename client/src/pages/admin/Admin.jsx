// US-ADM-001..005: staff, formulary, service catalog, SLA targets, immutable audit log.
// DEC-051: WhatsApp provider config (sending OFF by default).
import { useState, useEffect } from 'react';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, useAsync } from '../../components/ui';

function StaffTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/staff').then(r => r.data));
  const [form, setForm] = useState({ full_name: '', role: 'nurse', email: '', phone: '', password: '', specialty: '' });
  const [state, setState] = useState({ err: '', ok: '' });
  const create = async () => {
    setState({ err: '', ok: '' });
    try { await api.post('/admin/staff', form); setState({ ok: 'OK', err: '' }); setForm({ full_name: '', role: 'nurse', email: '', phone: '', password: '', specialty: '' }); reload(); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  const toggle = async s => { await api.patch(`/admin/staff/${s.id}/active`, { is_active: !s.is_active }); reload(); };
  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <table>
        <thead><tr><th>{t('name')}</th><th>{t('role')}</th><th>{t('email')}</th><th>{t('specialty')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>
          {(data || []).map(s => (
            <tr key={s.id}>
              <td>{s.full_name}</td><td>{t(s.role)}</td><td dir="ltr">{s.email}</td><td>{s.specialty || '—'}</td>
              <td>{s.is_active ? t('active') : t('inactive')}</td>
              <td><button onClick={() => toggle(s)}>{s.is_active ? t('deactivate') : t('activate')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('createStaff')}</h2>
      <div className="grid2">
        <Field label={t('fullName')}><input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></Field>
        <Field label={t('role')}>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {['nurse', 'coordinator', 'doctor', 'admin'].map(r => <option key={r} value={r}>{t(r)}</option>)}
          </select>
        </Field>
        <Field label={t('email')}><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
        <Field label={t('phone')}><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
        <Field label={t('password')}><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} dir="ltr" /></Field>
        <Field label={t('specialty')}><input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} /></Field>
      </div>
      <button onClick={create}>{t('createStaff')}</button>
    </div>
  );
}

function FormularyTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/formulary').then(r => r.data));
  const [form, setForm] = useState({ generic_name: '', brand_name: '', dosages: '', route: '' });
  const [state, setState] = useState({ err: '', ok: '' });
  const create = async () => {
    setState({ err: '', ok: '' });
    try {
      await api.post('/admin/formulary', { generic_name: form.generic_name, brand_name: form.brand_name, route: form.route, common_dosages: form.dosages.split(',').map(s => s.trim()).filter(Boolean) });
      setForm({ generic_name: '', brand_name: '', dosages: '', route: '' }); setState({ ok: 'OK', err: '' }); reload();
    } catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  const toggle = async d => { await api.patch(`/admin/formulary/${d.id}`, { is_active: !d.is_active }); reload(); };
  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <table>
        <thead><tr><th>{t('genericName')}</th><th>{t('brandName')}</th><th>{t('dosage')}</th><th>{t('route')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>
          {(data || []).map(d => (
            <tr key={d.id}>
              <td>{d.generic_name}</td><td>{d.brand_name || '—'}</td><td>{(d.common_dosages || []).join(', ')}</td><td>{d.route || '—'}</td>
              <td>{d.is_active ? t('active') : t('inactive')}</td>
              <td><button onClick={() => toggle(d)}>{d.is_active ? t('deactivate') : t('activate')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('addDrug')}</h2>
      <div className="grid2">
        <Field label={t('genericName')}><input value={form.generic_name} onChange={e => setForm({ ...form, generic_name: e.target.value })} /></Field>
        <Field label={t('brandName')}><input value={form.brand_name} onChange={e => setForm({ ...form, brand_name: e.target.value })} /></Field>
        <Field label={t('dosages')}><input value={form.dosages} onChange={e => setForm({ ...form, dosages: e.target.value })} /></Field>
        <Field label={t('route')}><input value={form.route} onChange={e => setForm({ ...form, route: e.target.value })} /></Field>
      </div>
      <button onClick={create}>{t('addDrug')}</button>
    </div>
  );
}

function ServicesTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/services').then(r => r.data));
  const patch = async (s, p) => { await api.patch(`/admin/services/${s.id}`, p); reload(); };
  return (
    <div>
      <Msg err={err} />
      <table>
        <thead><tr><th>{t('selectService')}</th><th>{t('on')}/{t('off')}</th><th>{t('comingSoon')}</th></tr></thead>
        <tbody>
          {(data || []).map(s => (
            <tr key={s.id}>
              <td>{s.name_en} / {s.name_ar}</td>
              <td><button onClick={() => patch(s, { is_active: !s.is_active, coming_soon: !s.is_active ? false : s.coming_soon })}>{s.is_active ? t('on') : t('off')}</button></td>
              <td><button onClick={() => patch(s, { coming_soon: !s.coming_soon, is_active: !s.coming_soon ? false : s.is_active })}>{s.coming_soon ? t('on') : t('off')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlaTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/sla').then(r => r.data));
  const [vals, setVals] = useState({});
  const [state, setState] = useState({ err: '', ok: '' });
  // DEC-041: save feedback — failures were previously silent (no catch, no message).
  const save = async status => {
    setState({ err: '', ok: '' });
    try {
      await api.patch(`/admin/sla/${status}`, { target_minutes: Number(vals[status] ?? data.find(x => x.status === status).target_minutes) });
      setState({ ok: 'OK', err: '' });
      reload();
    } catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <table>
        <thead><tr><th>{t('status')}</th><th>{t('targetMinutes')}</th><th>{t('actions')}</th></tr></thead>
        <tbody>
          {(data || []).map(s => (
            <tr key={s.status}>
              <td>{s.status}</td>
              <td><input style={{ maxWidth: 120 }} type="number" defaultValue={s.target_minutes} onChange={e => setVals({ ...vals, [s.status]: e.target.value })} /></td>
              <td><button onClick={() => save(s.status)}>{t('save')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ action: '', actor_role: '', from: '', to: '' });
  const [query, setQuery] = useState('');
  const { data, err, reload } = useAsync(() => api.get(`/admin/audit-logs${query}`).then(r => r.data), [query]);
  const apply = () => {
    const p = new URLSearchParams();
    if (filters.action) p.set('action', filters.action);
    if (filters.actor_role) p.set('actor_role', filters.actor_role);
    if (filters.from) p.set('from', new Date(filters.from).toISOString());
    if (filters.to) p.set('to', new Date(filters.to).toISOString());
    setQuery(p.toString() ? `?${p}` : '');
    reload();
  };
  return (
    <div>
      <Msg err={err} />
      <div className="row">
        <input style={{ maxWidth: 200 }} placeholder={t('action')} value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })} />
        <select style={{ maxWidth: 160 }} value={filters.actor_role} onChange={e => setFilters({ ...filters, actor_role: e.target.value })}>
          <option value="">{t('role')}</option>
          {['patient', 'nurse', 'coordinator', 'doctor', 'admin', 'international', 'system', 'anonymous'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input style={{ maxWidth: 180 }} type="datetime-local" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        <input style={{ maxWidth: 180 }} type="datetime-local" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
        <button onClick={apply}>{t('apply')}</button>
      </div>
      <table>
        <thead><tr><th>{t('time')}</th><th>{t('actor')}</th><th>{t('action')}</th><th>{t('resource')}</th><th>{t('ip')}</th></tr></thead>
        <tbody>
          {(data || []).map(a => (
            <tr key={a.id}>
              <td>{fmtDate(a.created_at)}</td>
              <td>{a.actor_role}{a.actor_id ? ` · ${a.actor_id.slice(0, 8)}` : ''}</td>
              <td>{a.action}</td>
              <td>{a.resource_type || '—'}{a.resource_id ? ` · ${a.resource_id.slice(0, 8)}` : ''}</td>
              <td dir="ltr">{a.ip_address || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// DEC-051/053: credentials are stored server-side; the token field is write-only.
// Login OTP and status updates are switched independently.
function WhatsAppTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/settings/whatsapp').then(r => r.data));
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ err: '', ok: '' });
  const [testTo, setTestTo] = useState('');
  const [templates, setTemplates] = useState(null);

  useEffect(() => {
    if (data) setForm({
      otp_enabled: data.otp_enabled, notify_enabled: data.notify_enabled,
      waba_id: data.waba_id, phone_number_id: data.phone_number_id,
      api_version: data.api_version, otp_template: data.otp_template, otp_template_lang: data.otp_template_lang,
      otp_profile_lang: data.otp_profile_lang, notify_template: data.notify_template,
      notify_template_lang: data.notify_template_lang, token: ''
    });
  }, [data]);

  if (!form) return <p className="muted">{t('loading')}</p>;
  const set = (k, v) => setForm({ ...form, [k]: v });
  // Badges follow each toggle; the local mock kill switch is an environment override.
  const modeKeyFor = on => !on ? 'waMode_disabled'
    : !data?.configured ? 'waMode_not_configured'
      : data?.mock_switch ? 'waMode_mock' : 'waMode_live';
  // DEC-052: surface anything that would bill at MARKETING rates, or could drift there.
  const marketingTemplates = (templates || []).filter(x => x.category === 'MARKETING');
  const riskTemplates = (templates || []).filter(x => x.marketing_risk && x.category !== 'MARKETING');
  const label = x => `${x.name} [${x.language}]`;

  const save = async () => {
    setState({ err: '', ok: '' });
    try {
      const payload = { ...form };
      if (!payload.token) delete payload.token; // blank keeps the stored token
      await api.patch('/admin/settings/whatsapp', payload);
      setForm({ ...form, token: '' });
      setState({ ok: t('savedAt'), err: '' });
      reload();
    } catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  const sendTest = async () => {
    setState({ err: '', ok: '' });
    try {
      const r = await api.post('/admin/settings/whatsapp/test', { to: testTo });
      setState({ ok: r.data.mock ? t('waTestMock') : t('waTestOk'), err: '' });
    } catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  const loadTemplates = async () => {
    setState({ err: '', ok: '' });
    try { setTemplates((await api.get('/admin/settings/whatsapp/templates')).data.items); }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };
  // Explicit null clears the stored secret; the server refuses while sending is ON.
  const clearToken = async () => {
    setState({ err: '', ok: '' });
    try {
      await api.patch('/admin/settings/whatsapp', { token: null });
      setState({ ok: t('savedAt'), err: '' });
      reload();
    } catch (e) { setState({ err: errMsg(e), ok: '' }); }
  };

  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <p className="muted">
        <strong>{t('waOtpChannel')}:</strong> {t(modeKeyFor(data?.otp_enabled))}
        {' · '}<strong>{t('waNotifyChannel')}:</strong> {t(modeKeyFor(data?.notify_enabled))}
        {data?.token_set ? ` · ${t('waTokenSaved')} ${data.token_hint}` : ''}
      </p>
      {data?.mock_switch && <p className="muted">{t('waMockHint')}</p>}
      <p className="muted">{t('waCost')}</p>
      <label style={{ fontWeight: 400 }}>
        <input type="checkbox" checked={form.otp_enabled} onChange={e => set('otp_enabled', e.target.checked)} /> {t('waOtpEnable')}
      </label>
      <label style={{ fontWeight: 400 }}>
        <input type="checkbox" checked={form.notify_enabled} onChange={e => set('notify_enabled', e.target.checked)} /> {t('waNotifyEnable')}
      </label>
      <p className="muted">{t('waSplitHint')}</p>
      <div className="grid2">
        <Field label={t('waWabaId')}><input dir="ltr" value={form.waba_id} onChange={e => set('waba_id', e.target.value)} /></Field>
        <Field label={t('waPhoneNumberId')}><input dir="ltr" value={form.phone_number_id} onChange={e => set('phone_number_id', e.target.value)} /></Field>
        <Field label={t('waToken')}>
          <input dir="ltr" type="password" autoComplete="off" value={form.token}
            placeholder={data?.token_set ? t('waTokenKeep') : ''} onChange={e => set('token', e.target.value)} />
        </Field>
        <Field label={t('waApiVersion')}><input dir="ltr" value={form.api_version} onChange={e => set('api_version', e.target.value)} /></Field>
        <Field label={t('waOtpTemplate')}><input dir="ltr" value={form.otp_template} onChange={e => set('otp_template', e.target.value)} /></Field>
        <Field label={t('waOtpLang')}><input dir="ltr" value={form.otp_template_lang} onChange={e => set('otp_template_lang', e.target.value)} /></Field>
        <Field label={t('waNotifyTemplate')}><input dir="ltr" value={form.notify_template} onChange={e => set('notify_template', e.target.value)} /></Field>
        <Field label={t('waNotifyLang')}><input dir="ltr" value={form.notify_template_lang} onChange={e => set('notify_template_lang', e.target.value)} /></Field>
      </div>
      <label style={{ fontWeight: 400 }}>
        <input type="checkbox" checked={form.otp_profile_lang} onChange={e => set('otp_profile_lang', e.target.checked)} /> {t('waProfileLang')}
      </label>
      <p className="muted">{t('waNotifyHint')}</p>
      <div className="row">
        <button onClick={save}>{t('save')}</button>
        {data?.token_set && <button onClick={clearToken}>{t('waTokenClear')}</button>}
      </div>

      <h2>{t('waTest')}</h2>
      <div className="row">
        <input dir="ltr" placeholder="+9665XXXXXXXX" value={testTo} onChange={e => setTestTo(e.target.value)} />
        <button onClick={sendTest}>{t('waTest')}</button>
      </div>
      <p className="muted">{t('waTestHint')}</p>

      <h2>{t('waTemplates')}</h2>
      <p className="muted">{t('waCategoryPolicy')}</p>
      <button onClick={loadTemplates}>{t('waLoadTemplates')}</button>
      {!!marketingTemplates.length && (
        <p style={{ color: '#b3261e', fontWeight: 600 }}>{t('waMarketingFound')}: {marketingTemplates.map(label).join(', ')}</p>
      )}
      {!!riskTemplates.length && (
        <p className="muted">{t('waRiskFound')}: {riskTemplates.map(label).join(', ')}</p>
      )}
      {!!templates?.length && (
        <table>
          <thead><tr><th>{t('name')}</th><th>{t('waLang')}</th><th>{t('category')}</th><th>{t('status')}</th><th>{t('waVars')}</th></tr></thead>
          <tbody>
            {templates.map((tpl, i) => (
              <tr key={`${tpl.name}-${tpl.language}-${i}`}>
                <td dir="ltr">{tpl.name}</td><td dir="ltr">{tpl.language}</td>
                <td style={tpl.category === 'MARKETING' ? { color: '#b3261e', fontWeight: 600 } : undefined}>{tpl.category}</td>
                <td>{tpl.status}</td><td>{tpl.body_vars}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HospitalsTab() {
  const { t } = useI18n();
  const { data: hospData, err: hospErr, reload: reloadHosps } = useAsync(() => api.get('/admin/hospitals').then(r => r.data.hospitals || []));
  const { data: staffData, reload: reloadStaff } = useAsync(() => api.get('/admin/staff').then(r => r.data || []));

  const [form, setForm] = useState({ name: '', short_name: '', city: 'Riyadh', phone: '', kiosk_pin: '' });
  const [adminModalHosp, setAdminModalHosp] = useState(null);
  const [adminForm, setAdminForm] = useState({ full_name: '', phone: '', preferred_lang: 'en' });
  const [state, setState] = useState({ err: '', ok: '' });
  const [adminState, setAdminState] = useState({ err: '', ok: '' });

  const reloadAll = () => {
    reloadHosps();
    reloadStaff();
  };

  const createHosp = async (e) => {
    e?.preventDefault();
    setState({ err: '', ok: '' });
    try {
      await api.post('/admin/hospitals', {
        name: form.name.trim(),
        short_name: form.short_name.trim().toUpperCase() || form.name.slice(0, 4).toUpperCase(),
        city: form.city.trim(),
        phone: form.phone.trim() || null,
        kiosk_pin: form.kiosk_pin.trim() || undefined
      });
      setState({ ok: 'Hospital provisioned successfully!', err: '' });
      setForm({ name: '', short_name: '', city: 'Riyadh', phone: '', kiosk_pin: '' });
      reloadAll();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const toggleHosp = async (h) => {
    try {
      await api.patch(`/admin/hospitals/${h.id}`, { is_active: !h.is_active });
      reloadAll();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const toggleStaff = async (s) => {
    try {
      await api.patch(`/admin/staff/${s.id}/active`, { is_active: !s.is_active });
      reloadAll();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const createAdmin = async (e) => {
    e?.preventDefault();
    if (!adminModalHosp) return;
    setAdminState({ err: '', ok: '' });
    try {
      await api.post(`/admin/hospitals/${adminModalHosp.id}/admins`, {
        full_name: adminForm.full_name.trim(),
        phone: adminForm.phone.trim(),
        preferred_lang: adminForm.preferred_lang
      });
      setAdminState({ ok: 'Hospital Admin created! They can now log in via WhatsApp OTP.', err: '' });
      setAdminForm({ full_name: '', phone: '', preferred_lang: 'en' });
      reloadAll();
    } catch (err) {
      setAdminState({ err: errMsg(err), ok: '' });
    }
  };

  const hospitals = hospData || [];
  const staff = staffData || [];

  return (
    <div>
      <Msg err={hospErr || state.err} ok={state.ok} />
      
      <table>
        <thead>
          <tr>
            <th>{t('hospitalName')}</th>
            <th>{t('shortName')}</th>
            <th>{t('city')}</th>
            <th>{t('kioskPin')}</th>
            <th>{t('status')}</th>
            <th>{t('roleHospitalAdmin')}</th>
            <th>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {hospitals.map(h => {
            const hospAdmins = staff.filter(s => s.hospital_id === h.id && s.role === 'hospital_admin');
            return (
              <tr key={h.id}>
                <td><strong>{h.name}</strong></td>
                <td><code>{h.short_name}</code></td>
                <td>{h.city}</td>
                <td><code>{h.kiosk_pin}</code></td>
                <td>{h.is_active ? t('active') : t('inactive')}</td>
                <td>
                  {hospAdmins.length === 0 ? (
                    <span className="muted">No admin assigned</span>
                  ) : (
                    <div style={{ fontSize: 13 }}>
                      {hospAdmins.map(a => (
                        <div key={a.id} style={{ marginBottom: 4 }}>
                          <strong>{a.full_name}</strong> ({a.phone_e164 || a.phone}){' '}
                          <button
                            style={{ padding: '1px 6px', fontSize: 11 }}
                            onClick={() => toggleStaff(a)}
                          >
                            {a.is_active ? t('deactivate') : t('activate')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() => {
                        setAdminModalHosp(h);
                        setAdminState({ err: '', ok: '' });
                      }}
                    >
                      + {t('addHospitalAdmin')}
                    </button>
                    <button
                      style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={() => toggleHosp(h)}
                    >
                      {h.is_active ? t('deactivate') : t('activate')}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {adminModalHosp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div className="box" style={{ background: '#fff', maxWidth: 500, width: '90%', padding: 24 }}>
            <h3>{t('addHospitalAdmin')}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Hospital: <strong>{adminModalHosp.name}</strong> ({adminModalHosp.short_name})
            </p>
            <Msg err={adminState.err} ok={adminState.ok} />
            <form onSubmit={createAdmin}>
              <Field label={t('fullName')}>
                <input
                  required
                  placeholder="e.g. Adrian Lewis (Operations Lead)"
                  value={adminForm.full_name}
                  onChange={e => setAdminForm({ ...adminForm, full_name: e.target.value })}
                />
              </Field>
              <Field label={t('phone') + ' (WhatsApp Mobile)'}>
                <input
                  required
                  dir="ltr"
                  placeholder="e.g. +966501112233"
                  value={adminForm.phone}
                  onChange={e => setAdminForm({ ...adminForm, phone: e.target.value })}
                />
              </Field>
              <Field label={t('language')}>
                <select
                  value={adminForm.preferred_lang}
                  onChange={e => setAdminForm({ ...adminForm, preferred_lang: e.target.value })}
                >
                  <option value="en">English (en)</option>
                  <option value="ar">العربية (ar)</option>
                </select>
              </Field>
              <div className="row" style={{ marginTop: 16 }}>
                <button type="submit">{t('addHospitalAdmin')}</button>
                <button type="button" onClick={() => setAdminModalHosp(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <h2>{t('provisionHospital')}</h2>
      <form onSubmit={createHosp}>
        <div className="grid2">
          <Field label={t('hospitalName')}>
            <input
              required
              placeholder="e.g. King Fahd Medical City"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label={t('shortName')}>
            <input
              placeholder="e.g. KFMC"
              value={form.short_name}
              onChange={e => setForm({ ...form, short_name: e.target.value })}
            />
          </Field>
          <Field label={t('city')}>
            <input
              required
              placeholder="e.g. Riyadh"
              value={form.city}
              onChange={e => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label={t('phone')}>
            <input
              dir="ltr"
              placeholder="e.g. +966112345678"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label={t('kioskPin') + ' (6 digits, optional)'}>
            <input
              dir="ltr"
              maxLength={6}
              placeholder="Leave blank to auto-generate"
              value={form.kiosk_pin}
              onChange={e => setForm({ ...form, kiosk_pin: e.target.value })}
            />
          </Field>
        </div>
        <button type="submit">{t('provisionHospital')}</button>
      </form>
    </div>
  );
}

export default function Admin() {
  const { t } = useI18n();
  const [tab, setTab] = useState('staff');
  const tabs = [
    ['staff', 'staffMgmt'],
    ['hospitals', 'hospitalsAdmin'],
    ['formulary', 'formularyAdmin'],
    ['services', 'servicesAdmin'],
    ['sla', 'sla'],
    ['whatsapp', 'whatsapp'],
    ['audit', 'auditLog']
  ];
  return (
    <div>
      <h1>{t('admin')}</h1>
      <div className="tabs">
        {tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{t(label)}</button>)}
      </div>
      {tab === 'staff' && <StaffTab />}
      {tab === 'hospitals' && <HospitalsTab />}
      {tab === 'formulary' && <FormularyTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}