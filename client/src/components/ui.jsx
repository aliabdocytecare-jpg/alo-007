// Shared text-UI primitives (DEC-004). Every visible button functions (P3).
import { Component, useEffect, useRef, useState } from 'react';
import { api, errMsg, fmtDate } from '../lib/api';
import { useI18n } from '../lib/i18n';

// DEC-040: crash fallback — a render exception must never white-screen the portal.
// Bilingual static copy: the i18n provider itself may be what crashed.
export class ErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('UI crash:', err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="wrap">
        <section className="box">
          <h1>Something went wrong / حدث خطأ غير متوقع</h1>
          <p className="muted">Your data is safe. Reload the page to continue. / بياناتك محفوظة. أعد تحميل الصفحة للمتابعة.</p>
          <div className="row">
            <button onClick={() => window.location.reload()}>Reload / إعادة تحميل</button>
            <a className="btn" href="/">Home / الرئيسية</a>
          </div>
        </section>
      </div>
    );
  }
}

export function Msg({ err, ok }) {
  if (!err && !ok) return null;
  return <div className={`msg ${err ? 'err' : 'ok'}`}>{err || ok}</div>;
}

export function Field({ label, children }) {
  return (<><label>{label}</label>{children}</>);
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  dir = 'ltr',
  required = false,
  disabled = false,
  autoComplete = 'current-password',
  className = '',
  style = {}
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%', ...style }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        dir={dir}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        className={className}
        style={{ width: '100%', paddingRight: dir === 'ltr' ? '38px' : '8px', paddingLeft: dir === 'rtl' ? '38px' : '8px', boxSizing: 'border-box' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        style={{
          position: 'absolute',
          right: dir === 'ltr' ? '6px' : 'auto',
          left: dir === 'rtl' ? '6px' : 'auto',
          background: 'transparent',
          border: 'none',
          padding: '4px 6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          lineHeight: 1
        }}
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}

export function StatusBadge({ status }) {
  const { t } = useI18n();
  return <span className="badge">{t('st' + status) || status}</span>;
}

export function Timeline({ events, internal = false }) {
  const { lang, t } = useI18n();
  if (!events?.length) return <p className="muted">{t('noItems')}</p>;
  return (
    <ul className="timeline">
      {events.map(e => (
        <li key={e.id}>
          <strong>{internal ? `${e.from_status || '—'} → ${e.to_status || '—'}` : (lang === 'ar' ? e.message_ar : e.message_en) || e.to_status}</strong>
          {internal && e.actor_role && <span className="muted"> [{e.actor_role}]</span>}
          {e.note && <div className="muted">{e.note}</div>}
          <div className="muted">{fmtDate(e.created_at)}</div>
        </li>
      ))}
    </ul>
  );
}

export const DOC_CATEGORIES = ['Medical Report', 'Lab Result', 'Imaging', 'Prescription', 'ID Document', 'Other'];
const CAT_KEYS = { 'Medical Report': 'catReport', 'Lab Result': 'catLab', 'Imaging': 'catImaging', 'Prescription': 'catRx', 'ID Document': 'catId', 'Other': 'catOther' };

export function DocumentList({ caseId, documents, canDelete = false, onChanged }) {
  const { t } = useI18n();
  const [err, setErr] = useState('');
  const del = async id => {
    try { await api.delete(`/cases/${caseId}/documents/${id}`); onChanged?.(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div>
      <Msg err={err} />
      {!documents?.length && <p className="muted">{t('noItems')}</p>}
      {!!documents?.length && (
        <table>
          <thead><tr><th>{t('name')}</th><th>{t('category')}</th><th>{t('created')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {documents.map(d => (
              <tr key={d.id}>
                <td>{d.file_name}</td>
                <td>{t(CAT_KEYS[d.category] || 'catOther')}</td>
                <td>{fmtDate(d.created_at)}</td>
                <td className="row">
                  <a className="btn" href={`/api/v1/cases/${caseId}/documents/${d.id}`} target="_blank" rel="noreferrer">{t('open')}</a>
                  {canDelete && <button onClick={() => del(d.id)}>×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function FileUploader({ caseId, onUploaded, multiple = true }) {
  const { t } = useI18n();
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState('Medical Report');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const doUpload = async () => {
    if (!files.length) return;
    setBusy(true); setErr(''); setOk('');
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('category', category);
        await api.post(`/cases/${caseId}/documents`, fd);
      }
      setOk(`${t('uploaded')}: ${files.length}`);
      setFiles([]);
      onUploaded?.();
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  return (
    <div className="no-print">
      <Field label={t('files')}>
        <input id="uploader-files" type="file" multiple={multiple} accept=".pdf,.jpg,.jpeg,.png,.docx" style={{ display: 'none' }}
          onChange={e => setFiles(Array.from(e.target.files || []))} />
        <label className="btn" htmlFor="uploader-files">{t('chooseFiles')}</label>
        <span className="muted"> {files.length ? files.map(f => f.name).join(', ') : t('noFileChosen')}</span>
      </Field>
      <Field label={t('category')}>
        <select data-testid="doc-category" value={category} onChange={e => setCategory(e.target.value)}>
          {DOC_CATEGORIES.map(c => <option key={c} value={c}>{t(CAT_KEYS[c])}</option>)}
        </select>
      </Field>
      {files.length > 0 && <p className="muted">{files.map(f => f.name).join(', ')}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={doUpload} disabled={busy || !files.length}>{busy ? t('loading') : t('upload')}</button>
      </div>
      <Msg err={err} ok={ok} />
    </div>
  );
}

// Inline preview for review/staff views: PDF iframe, image inline, others download.
export function DocPreview({ url, doc }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  // DEC-030: click-to-load PDF preview. An inline PDF viewer grabs focus and
  // scrolls the page while initializing, yanking specialists mid-form-fill.
  // Load the viewer only on explicit request (also saves mobile bandwidth).
  if (doc.file_type === 'application/pdf') {
    return show
      ? <iframe className="docframe" src={url} title={doc.file_name} />
      : <button className="btn" onClick={() => setShow(true)}>{t('previewPdf')}: {doc.file_name}</button>;
  }
  if (doc.file_type?.startsWith('image/')) return <img className="docimg" src={url} alt={doc.file_name} />;
  return <a className="btn" href={url} target="_blank" rel="noreferrer">{t('download')}: {doc.file_name}</a>;
}

export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const hasData = useRef(false);
  const reload = () => setTick(x => x + 1);
  // DEC-025: stale-while-revalidate — never unmount consumers during a refresh.
  useEffect(() => {
    let live = true;
    if (!hasData.current) setLoading(true);
    fn().then(d => { if (live) { hasData.current = true; setData(d); setErr(''); } })
      .catch(e => { if (live) setErr(errMsg(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [...deps, tick]);
  return { data, err, loading, reload, setErr };
}

export function Spinner() {
  return <span className="alo-spinner" aria-hidden="true" />;
}

export function ActionButton({ onClick, disabled, children, style, className = '', type = 'button', okText = 'Saved' }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ ok: '', err: '' });

  const handleClick = async (e) => {
    if (!onClick || busy || disabled) return;
    setBusy(true);
    setStatus({ ok: '', err: '' });
    try {
      const res = await onClick(e);
      if (res !== false) {
        setStatus({ ok: typeof res === 'string' ? res : okText, err: '' });
      }
    } catch (err) {
      setStatus({ ok: '', err: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        type={type}
        className={className}
        disabled={disabled || busy}
        onClick={handleClick}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}
      >
        {busy && <Spinner />}
        {children}
      </button>
      {status.ok && (
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#15803d', background: '#dcfce7', border: '1px solid #86efac', padding: '3px 8px', borderRadius: 4 }}>
          ✓ {status.ok}
        </span>
      )}
      {status.err && (
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#b91c1c', background: '#fee2e2', border: '1px solid #fca5a5', padding: '3px 8px', borderRadius: 4 }}>
          ⚠ {status.err}
        </span>
      )}
    </span>
  );
}