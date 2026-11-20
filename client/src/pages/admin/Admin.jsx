// US-ADM-001..005: staff, formulary, service catalog, SLA targets, immutable audit log.
import { useState } from 'react';
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

export default function Admin() {
  const { t } = useI18n();
  const [tab, setTab] = useState('staff');
  const tabs = [['staff', 'staffMgmt'], ['formulary', 'formularyAdmin'], ['services', 'servicesAdmin'], ['sla', 'sla'], ['audit', 'auditLog']];
  return (
    <div>
      <h1>{t('admin')}</h1>
      <div className="tabs">
        {tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{t(label)}</button>)}
      </div>
      {tab === 'staff' && <StaffTab />}
      {tab === 'formulary' && <FormularyTab />}
      {tab === 'services' && <ServicesTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}