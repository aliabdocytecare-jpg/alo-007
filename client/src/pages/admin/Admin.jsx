// US-ADM-001..005: staff, formulary, service catalog, SLA targets, immutable audit log.
// DEC-051: WhatsApp provider config (sending OFF by default).
import { useState, useEffect } from 'react';
import { api, errMsg, fmtDate } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Msg, Field, PasswordInput, useAsync } from '../../components/ui';

function StaffTab() {
  const { t } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/admin/staff').then(r => r.data));
  const { data: specData } = useAsync(() => api.get('/specialties').then(r => r.data || []));
  const [form, setForm] = useState({ full_name: '', role: 'nurse', email: '', phone: '', specialty: '' });
  const [state, setState] = useState({ err: '', ok: '' });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setState({ err: '', ok: '' });
    if (!form.full_name?.trim()) {
      setState({ err: 'Full name is required.', ok: '' });
      return;
    }
    if (!form.email?.trim()) {
      setState({ err: 'Email is required. An invitation email will be sent to activate the account.', ok: '' });
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form };
      if (payload.role === 'doctor' && !payload.specialty && specData?.length) {
        payload.specialty = specData[0].name_en;
      }
      await api.post('/admin/staff', payload);
      setState({ ok: `Invitation email sent to ${payload.email}. Staff member can now activate their account.`, err: '' });
      setForm({ full_name: '', role: 'nurse', email: '', phone: '', specialty: '' });
      reload();
    }
    catch (e) { setState({ err: errMsg(e), ok: '' }); }
    finally { setBusy(false); }
  };

  const toggle = async s => {
    try {
      await api.patch(`/admin/staff/${s.id}/active`, { is_active: !s.is_active });
      reload();
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  const resendInvite = async s => {
    setState({ err: '', ok: '' });
    try {
      const res = await api.post(`/admin/staff/${s.id}/resend-invite`);
      setState({ ok: res.data?.message || `Activation email resent to ${s.email}.`, err: '' });
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  const deleteStaffMember = async s => {
    const msg = `Are you sure you want to permanently delete staff member "${s.full_name}" (${s.email})?\n\nThis will remove their profile from the database. This action cannot be undone.`;
    if (!window.confirm(msg)) return;
    setState({ err: '', ok: '' });
    try {
      const res = await api.delete(`/admin/staff/${s.id}`);
      setState({ ok: res.data?.message || 'Staff member permanently deleted.', err: '' });
      reload();
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <table>
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('role')}</th>
            <th>{t('email')}</th>
            <th>{t('specialty')}</th>
            <th>{t('status')}</th>
            <th>{t('emailVerification')}</th>
            <th>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(data || []).map(s => (
            <tr key={s.id}>
              <td>{s.full_name}</td>
              <td>{t(s.role)}</td>
              <td dir="ltr">{s.email}</td>
              <td>{s.specialty || '—'}</td>
              <td>{s.is_active ? t('active') : t('inactive')}</td>
              <td>
                {s.email_verified ? (
                  <span style={{ color: '#059669', backgroundColor: '#ecfdf5', padding: '3px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                    {t('verified')}
                  </span>
                ) : (
                  <span style={{ color: '#d97706', backgroundColor: '#fffbeb', padding: '3px 8px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 600 }}>
                    {t('pendingActivation')}
                  </span>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={() => toggle(s)} style={{ padding: '4px 8px', fontSize: '0.85rem' }}>
                    {s.is_active ? t('deactivate') : t('activate')}
                  </button>
                  {!s.email_verified && (
                    <button onClick={() => resendInvite(s)} style={{ padding: '4px 8px', fontSize: '0.85rem' }} title="Resend invitation email">
                      {t('resendInvite')}
                    </button>
                  )}
                  <button
                    onClick={() => deleteStaffMember(s)}
                    style={{ padding: '4px 8px', fontSize: '0.85rem', color: '#dc2626', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
                    title="Permanently delete staff user"
                  >
                    {t('deleteStaff')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{t('inviteStaff')}</h2>
      <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1rem', marginTop: '-0.25rem' }}>
        {t('inviteStaffNotice')}
      </p>
      <div className="grid2">
        <Field label={t('fullName')}><input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. Dr. Sarah Jenkins" /></Field>
        <Field label={t('role')}>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {['nurse', 'admin'].map(r => <option key={r} value={r}>{t(r)}</option>)}
          </select>
        </Field>
        <Field label={`${t('email')} *`}><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} dir="ltr" placeholder="staff@hospital.com" required /></Field>
        <Field label={t('phoneOptional')}><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} dir="ltr" placeholder="+9665XXXXXXXX" /></Field>
        {form.role === 'doctor' ? (
          <Field label={t('specialty')}>
            <select
              value={form.specialty || (specData?.[0]?.name_en || '')}
              onChange={e => setForm({ ...form, specialty: e.target.value })}
            >
              {(specData || []).map(s => (
                <option key={s.id} value={s.name_en}>{s.name_en} {s.name_ar ? `(${s.name_ar})` : ''}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t('specialty')}><input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} placeholder="Optional" /></Field>
        )}
      </div>
      <button onClick={create} disabled={busy}>{busy ? '...' : `+ ${t('inviteStaff')}`}</button>
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
  const deleteDrug = async d => {
    const drugName = d.generic_name + (d.brand_name ? ` (${d.brand_name})` : '');
    if (!window.confirm(`Are you sure you want to permanently delete drug "${drugName}" from the formulary? This cannot be undone.`)) return;
    setState({ err: '', ok: '' });
    try {
      const res = await api.delete(`/admin/formulary/${d.id}`);
      setState({ ok: res.data?.message || 'Drug permanently deleted.', err: '' });
      reload();
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };
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
              <td>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button onClick={() => toggle(d)} style={{ padding: '4px 8px', fontSize: '0.85rem' }}>
                    {d.is_active ? t('deactivate') : t('activate')}
                  </button>
                  <button
                    onClick={() => deleteDrug(d)}
                    style={{ padding: '4px 8px', fontSize: '0.85rem', color: '#dc2626', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
                    title="Permanently delete drug"
                  >
                    {t('deleteStaff') || 'Delete'}
                  </button>
                </div>
              </td>
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
          <PasswordInput
            dir="ltr"
            autoComplete="off"
            value={form.token}
            placeholder={data?.token_set ? t('waTokenKeep') : ''}
            onChange={e => set('token', e.target.value)}
          />
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

  const [form, setForm] = useState({ name: '', short_name: '', city: 'Riyadh', phone: '' });
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
        phone: form.phone.trim() || null
      });
      setState({ ok: 'Hospital provisioned successfully!', err: '' });
      setForm({ name: '', short_name: '', city: 'Riyadh', phone: '' });
      reloadAll();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const deleteHosp = async (h) => {
    if (!window.confirm(`Are you sure you want to permanently delete hospital "${h.name}" (${h.short_name})?`)) return;
    setState({ err: '', ok: '' });
    try {
      const res = await api.delete(`/admin/hospitals/${h.id}`);
      setState({ ok: res.data?.message || `Hospital "${h.name}" deleted.`, err: '' });
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
                    <button
                      style={{ fontSize: 12, padding: '3px 8px', color: '#dc2626', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
                      onClick={() => deleteHosp(h)}
                    >
                      {t('deleteStaff') || 'Delete'}
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
        </div>
        <button type="submit">{t('provisionHospital')}</button>
      </form>
    </div>
  );
}

function SpecialtiesTab() {
  const { t } = useI18n();
  const { data: specialties, err, reload } = useAsync(() => api.get('/admin/specialties').then(r => r.data || []));
  const [form, setForm] = useState({ name_en: '', name_ar: '' });
  const [state, setState] = useState({ err: '', ok: '' });

  const createSpecialty = async (e) => {
    e?.preventDefault();
    setState({ err: '', ok: '' });
    try {
      await api.post('/admin/specialties', {
        name_en: form.name_en.trim(),
        name_ar: form.name_ar.trim()
      });
      setState({ ok: 'Specialty created successfully!', err: '' });
      setForm({ name_en: '', name_ar: '' });
      reload();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const toggleSpecialty = async (s) => {
    try {
      await api.patch(`/admin/specialties/${s.id}`, { is_active: !s.is_active });
      reload();
    } catch (err) {
      setState({ err: errMsg(err), ok: '' });
    }
  };

  const list = specialties || [];

  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <table>
        <thead>
          <tr>
            <th>{t('specialtyNameEn')}</th>
            <th>{t('specialtyNameAr')}</th>
            <th>{t('status')}</th>
            <th>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map(s => (
            <tr key={s.id}>
              <td><strong>{s.name_en}</strong></td>
              <td dir="rtl">{s.name_ar}</td>
              <td><span className="badge">{s.is_active ? t('active') : t('inactive')}</span></td>
              <td>
                <button
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => toggleSpecialty(s)}
                >
                  {s.is_active ? t('deactivate') : t('activate')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{t('provisionSpecialty')}</h2>
      <form onSubmit={createSpecialty}>
        <div className="grid2">
          <Field label={t('specialtyNameEn')}>
            <input
              required
              placeholder="e.g. Cardiology"
              value={form.name_en}
              onChange={e => setForm({ ...form, name_en: e.target.value })}
            />
          </Field>
          <Field label={t('specialtyNameAr')}>
            <input
              required
              dir="rtl"
              placeholder="e.g. أمراض القلب"
              value={form.name_ar}
              onChange={e => setForm({ ...form, name_ar: e.target.value })}
            />
          </Field>
        </div>
        <button type="submit" style={{ marginTop: 8 }}>{t('addSpecialty')}</button>
      </form>
    </div>
  );
}

function ConsultantsTab() {
  const { t, lang } = useI18n();
  const { data, err, reload } = useAsync(() => api.get('/staff/intl-specialists').then(r => r.data?.specialists || []));
  const { data: specData } = useAsync(() => api.get('/specialties').then(r => r.data || []));
  const [form, setForm] = useState({ full_name: '', phone_e164: '', specialty: '' });
  const [state, setState] = useState({ err: '', ok: '' });
  const [busy, setBusy] = useState(false);

  const addConsultant = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setState({ err: '', ok: '' });
    if (!form.full_name.trim() || !form.phone_e164.trim()) {
      setState({ err: 'Consultant Name and Mobile Number are required.', ok: '' });
      return;
    }
    const chosenSpec = form.specialty || specData?.[0]?.name_en || 'General Medicine';
    setBusy(true);
    try {
      await api.post('/staff/intl-specialists', {
        full_name: form.full_name.trim(),
        phone_e164: form.phone_e164.trim(),
        specialty: chosenSpec
      });
      setState({ ok: `Added ${form.full_name.trim()} (${chosenSpec}) to International Consultants.`, err: '' });
      setForm({ full_name: '', phone_e164: '', specialty: '' });
      reload();
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    } finally {
      setBusy(false);
    }
  };

  const removeConsultant = async (c) => {
    if (!window.confirm(`Remove "${c.full_name}" (${c.phone_e164 || ''}) from International Consultants?`)) return;
    setState({ err: '', ok: '' });
    try {
      await api.delete(`/staff/intl-specialists/${c.id}`);
      setState({ ok: `${c.full_name} removed.`, err: '' });
      reload();
    } catch (e) {
      setState({ err: errMsg(e), ok: '' });
    }
  };

  return (
    <div>
      <Msg err={err || state.err} ok={state.ok} />
      <h2>International Consultants</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>
        Add Indian / International specialists with their specialty here. Nurses will see matching specialty consultants when dispatching a Magic Link.
      </p>
      <table>
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('specialty')}</th>
            <th>WhatsApp / Mobile</th>
            <th>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {(data || []).length === 0 ? (
            <tr><td colSpan={4} className="muted">No international consultants added yet.</td></tr>
          ) : (data || []).map(c => (
            <tr key={c.id}>
              <td><strong>{c.full_name}</strong></td>
              <td>{c.specialty || 'General Medicine'}</td>
              <td dir="ltr">{c.phone_e164 || '—'}</td>
              <td>
                <button
                  onClick={() => removeConsultant(c)}
                  style={{ padding: '4px 10px', fontSize: '0.85rem', color: '#dc2626', borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}
                >
                  {t('deleteStaff') || 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>Add International Consultant</h3>
      <form onSubmit={addConsultant}>
        <div className="grid2">
          <Field label="Consultant Name *">
            <input
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. Dr. Ramesh Patel"
              required
            />
          </Field>
          <Field label="Mobile / WhatsApp Number *">
            <input
              value={form.phone_e164}
              onChange={e => setForm({ ...form, phone_e164: e.target.value })}
              placeholder="+919876543210"
              dir="ltr"
              required
            />
          </Field>
          <Field label={`${t('specialty')} *`}>
            <select
              value={form.specialty || (specData?.[0]?.name_en || '')}
              onChange={e => setForm({ ...form, specialty: e.target.value })}
            >
              {(specData || []).length === 0 && <option value="General Medicine">General Medicine</option>}
              {(specData || []).map(s => (
                <option key={s.id} value={s.name_en}>
                  {lang === 'ar' && s.name_ar ? `${s.name_ar} (${s.name_en})` : s.name_en}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button type="submit" disabled={busy} style={{ marginTop: 10 }}>
          {busy ? '...' : '+ Add International Consultant'}
        </button>
      </form>
    </div>
  );
}

export default function Admin() {
  const { t } = useI18n();
  const [tab, setTab] = useState('staff');
  const tabs = [
    ['staff', 'staffMgmt'],
    ['consultants', 'intlConsultants'],
    ['hospitals', 'hospitalsAdmin'],
    ['specialties', 'specialtiesAdmin'],
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
      {tab === 'consultants' && <ConsultantsTab />}
      {tab === 'hospitals' && <HospitalsTab />}
      {tab === 'specialties' && <SpecialtiesTab />}
      {tab === 'formulary' && <FormularyTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}