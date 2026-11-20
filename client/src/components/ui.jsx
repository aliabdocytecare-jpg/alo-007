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