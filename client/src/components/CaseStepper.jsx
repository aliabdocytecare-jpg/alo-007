// DEC-070: Courier-Style Case Stepper Component (Practo & Mena Health Standard)
import { useI18n } from '../lib/i18n';

export default function CaseStepper({ workflow, status, compact = false }) {
  const { lang, t } = useI18n();

  if (!workflow || !workflow.stages) {
    return null;
  }

  const stages = workflow.stages;
  const currentStage = workflow.stage || 1;
  const isCancelled = status === 'CANCELLED';

  if (isCancelled) {
    return (
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', margin: '12px 0', color: '#991b1b' }}>
        <strong>{lang === 'ar' ? 'الحالة ملغاة' : 'Case Cancelled'}</strong>
        <p style={{ margin: '4px 0 0', fontSize: '0.88rem' }}>
          {lang === 'ar' ? 'تم إلغاء هذه الحالة. يرجى التواصل مع فريق الدعم للمساعدة.' : 'This case has been cancelled. Contact support if you need assistance.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      padding: compact ? '14px 16px' : '20px 24px',
      margin: '12px 0 20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
    }}>
      {/* Top Header: Current Stage Label & Custodian Pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? '16px' : '24px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b', fontWeight: 600 }}>
            {lang === 'ar' ? `المرحلة ${currentStage} من 5` : `Stage ${currentStage} of 5`}
          </span>
          <h3 style={{ margin: '2px 0 0', fontSize: compact ? '1.05rem' : '1.2rem', color: '#0f172a' }}>
            {workflow.stage_label}
          </h3>
        </div>

        {workflow.custodian && (
          <div style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: '20px',
            background: ['COORDINATOR', 'NURSE', 'ALO_NURSE'].includes(workflow.custodian) ? '#ecfdf5' : workflow.custodian === 'DOCTOR' ? '#e0f2fe' : '#fef3c7',
            color: ['COORDINATOR', 'NURSE', 'ALO_NURSE'].includes(workflow.custodian) ? '#047857' : workflow.custodian === 'DOCTOR' ? '#0369a1' : '#b45309',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {lang === 'ar'
              ? `بانتظار: ${['COORDINATOR', 'NURSE', 'ALO_NURSE'].includes(workflow.custodian) ? 'ممرض ألو' : workflow.custodian === 'DOCTOR' ? 'الطبيب' : 'المريض'}`
              : `Holding: ${['COORDINATOR', 'NURSE', 'ALO_NURSE'].includes(workflow.custodian) ? 'ALO NURSE' : workflow.custodian}`}
          </div>
        )}
      </div>

      {/* Horizontal Stepper Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        position: 'relative',
        margin: '0 auto',
        maxWidth: '100%'
      }}>
        {stages.map((st, idx) => {
          const isDone = st.isCompleted;
          const isCurrent = st.isCurrent;
          const isBlocked = st.isBlocked;
          const title = lang === 'ar' ? st.titleAr : st.titleEn;
          const desc = lang === 'ar' ? st.descAr : st.descEn;

          return (
            <div
              key={st.step}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                position: 'relative',
                textAlign: 'center'
              }}
            >
              {/* Connecting Line to next step */}
              {idx < stages.length - 1 && (
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  left: '50%',
                  width: '100%',
                  height: '3px',
                  background: isDone ? '#059669' : '#e2e8f0',
                  zIndex: 1,
                  transition: 'background 0.3s ease'
                }} />
              )}

              {/* Node Circle */}
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: isDone ? '0.95rem' : '0.85rem',
                zIndex: 2,
                position: 'relative',
                background: isDone ? '#059669' : isBlocked ? '#d97706' : isCurrent ? '#0284c7' : '#ffffff',
                color: isDone || isCurrent || isBlocked ? '#ffffff' : '#94a3b8',
                border: isDone || isCurrent || isBlocked ? 'none' : '2px solid #cbd5e1',
                boxShadow: isCurrent ? '0 0 0 4px #e0f2fe' : isBlocked ? '0 0 0 4px #fef3c7' : 'none',
                transition: 'all 0.3s ease'
              }}>
                {isDone ? '✓' : isBlocked ? '!' : st.step}
              </div>

              {/* Node Title & Description */}
              <div style={{ marginTop: '8px', padding: '0 4px' }}>
                <div style={{
                  fontSize: compact ? '0.78rem' : '0.85rem',
                  fontWeight: isCurrent ? 700 : isDone ? 600 : 500,
                  color: isCurrent ? '#0f172a' : isDone ? '#059669' : '#64748b'
                }}>
                  {title}
                </div>
                {!compact && (
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px', display: 'none' }} className="stepper-desc">
                    {desc}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next Action Callout Banner */}
      {workflow.next_action && (
        <div style={{
          marginTop: '20px',
          padding: '10px 14px',
          borderRadius: '6px',
          background: workflow.is_blocked ? '#fffbeb' : '#f8fafc',
          border: workflow.is_blocked ? '1px solid #fef3c7' : '1px solid #e2e8f0',
          fontSize: '0.86rem',
          color: workflow.is_blocked ? '#92400e' : '#334155',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ fontSize: '1rem' }}>{workflow.is_blocked ? '⚠️' : '👉'}</span>
          <div>
            <strong>{lang === 'ar' ? 'الخطوة التالية:' : 'Next Action:'}</strong>{' '}
            {workflow.next_action}
          </div>
        </div>
      )}
    </div>
  );
}
