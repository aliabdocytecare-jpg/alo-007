// Bible Part 5 — statuses, patient-facing labels (AR provisional per DEC-006), transitions.
export const LABELS = {
  SUBMITTED:                { en: "We've received your request",                  ar: 'تم استلام طلبك' },
  INITIAL_REVIEW:           { en: 'Our team is reviewing your case',              ar: 'فريقنا يراجع حالتك' },
  ADDITIONAL_INFO_REQUIRED: { en: 'We need a few more documents from you',        ar: 'نحتاج بعض المستندات الإضافية منك' },
  READY_FOR_ASSIGNMENT:     { en: 'Your case is being matched with a specialist', ar: 'يجري مطابقة حالتك مع مختص' },
  SPECIALIST_ASSIGNED:      { en: 'Your specialist has been assigned',            ar: 'تم تعيين المختص لحالتك' },
  UNDER_MEDICAL_REVIEW:     { en: 'Your case is under medical review',            ar: 'حالتك قيد المراجعة الطبية' },
  APPOINTMENT_SCHEDULED:    { en: 'Your appointment is confirmed',                ar: 'تم تأكيد موعدك' },
  IN_PROGRESS:              { en: 'Your consultation is in progress',             ar: 'استشارتك جارية' },
  REPORT_SUBMITTED:         { en: 'Your report is being prepared',                ar: 'يجري إعداد تقريرك' },
  FOLLOW_UP:                { en: 'Follow-up recommended',                        ar: 'يوصى بمتابعة' },
  COMPLETED:                { en: 'Your case is complete',                        ar: 'اكتملت حالتك' },
  CANCELLED:                { en: 'Cancelled',                                    ar: 'ملغاة' }
};

export const NEXT_STEP = {
  SUBMITTED:                { en: 'Our team will begin reviewing your case shortly.', ar: 'سيبدأ فريقنا بمراجعة حالتك قريبًا.' },
  INITIAL_REVIEW:           { en: 'Our team is reviewing your documents. We will update you within 24 hours.', ar: 'يراجع فريقنا مستنداتك. سنوافيك بالمستجدات خلال 24 ساعة.' },
  ADDITIONAL_INFO_REQUIRED: { en: 'Please upload the requested documents so your case can proceed.', ar: 'يرجى رفع المستندات المطلوبة لتتمكن حالتك من المتابعة.' },
  READY_FOR_ASSIGNMENT:     { en: 'We are matching your case with the right specialist.', ar: 'نعمل على مطابقة حالتك مع المختص المناسب.' },
  SPECIALIST_ASSIGNED:      { en: 'Your specialist has been assigned and will review your case.', ar: 'تم تعيين مختص لحالتك وسيقوم بمراجعتها.' },
  UNDER_MEDICAL_REVIEW:     { en: 'The specialist is reviewing your records. You will be notified when the opinion is ready.', ar: 'يراجع المختص سجلاتك. سنعلمك عند جاهزية الرأي الطبي.' },
  APPOINTMENT_SCHEDULED:    { en: 'Your appointment is confirmed. The meeting link appears 2 hours before your appointment.', ar: 'موعدك مؤكد. سيظهر رابط الاجتماع قبل ساعتين من الموعد.' },
  IN_PROGRESS:              { en: 'Your consultation is in progress.', ar: 'استشارتك جارية.' },
  REPORT_SUBMITTED:         { en: 'Your report is being prepared. You will be notified when it is ready.', ar: 'يجري إعداد تقريرك. سنعلمك عند جاهزيته.' },
  FOLLOW_UP:                { en: 'A follow-up is recommended. You can request it from this case.', ar: 'يوصى بمتابعة. يمكنك طلبها من هذه الحالة.' },
  COMPLETED:                { en: 'Your case is complete. Your report is available below.', ar: 'اكتملت حالتك. تقريرك متاح أدناه.' },
  CANCELLED:                { en: 'This case has been cancelled. Contact us if you need help.', ar: 'تم إلغاء هذه الحالة. تواصل معنا إذا احتجت مساعدة.' }
};

// Bible 5.3 — to_status -> allowed actor roles (Updated for Unified ALO Nurse Desk & Patient Self-Cancellation)
export const TRANSITIONS = {
  SUBMITTED:                { INITIAL_REVIEW: ['system', 'coordinator', 'nurse'] },
  INITIAL_REVIEW:           { ADDITIONAL_INFO_REQUIRED: ['coordinator', 'nurse'], READY_FOR_ASSIGNMENT: ['coordinator', 'nurse', 'admin'] },
  ADDITIONAL_INFO_REQUIRED: { INITIAL_REVIEW: ['system', 'coordinator', 'nurse'] },
  READY_FOR_ASSIGNMENT:     { SPECIALIST_ASSIGNED: ['coordinator', 'nurse'], ADDITIONAL_INFO_REQUIRED: ['coordinator', 'nurse'] },
  SPECIALIST_ASSIGNED:      { APPOINTMENT_SCHEDULED: ['coordinator', 'nurse'], IN_PROGRESS: ['doctor', 'coordinator', 'nurse'], REPORT_SUBMITTED: ['doctor', 'system'], UNDER_MEDICAL_REVIEW: ['system', 'doctor', 'coordinator', 'nurse'] },
  APPOINTMENT_SCHEDULED:    { IN_PROGRESS: ['doctor', 'system', 'coordinator', 'nurse'] },
  IN_PROGRESS:              { REPORT_SUBMITTED: ['doctor'] },
  UNDER_MEDICAL_REVIEW:     { REPORT_SUBMITTED: ['international', 'system'] },
  REPORT_SUBMITTED:         { COMPLETED: ['coordinator', 'nurse'] },
  COMPLETED:                { FOLLOW_UP: ['coordinator', 'nurse', 'doctor', 'system'] }
};

export const TERMINAL = ['COMPLETED', 'CANCELLED', 'FOLLOW_UP'];
export const ALL_STATUSES = Object.keys(LABELS);

// BR-020: cancellation by nurse/coordinator/admin or patient self-service (WP4), from any non-terminal status.
export function assertTransition(from, to, actorRole) {
  if (!ALL_STATUSES.includes(to)) return false;
  if (to === 'CANCELLED') {
    if (TERMINAL.includes(from)) return false;
    return ['nurse', 'coordinator', 'admin', 'patient'].includes(actorRole);
  }
  return (TRANSITIONS[from]?.[to] || []).includes(actorRole);
}