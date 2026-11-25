// DEC-070: Case Workflow Engine & Custodian Resolver
// Computes 5-stage Courier Stepper and role-based "Next Action / Ball-in-Court" To-Do metadata

export function computeCaseWorkflow(c, lang = 'en') {
  // Determine if this is a Written Opinion flow (GMO or written opinion subtype)
  const isWrittenOpinion = c.service_type === 'GMO' || c.service_subtype === 'WRITTEN' || Boolean(c.purpose);

  let stage = 1;
  let stageLabelEn = 'Case Received';
  let stageLabelAr = 'استلام الحالة';

  // Custodian: ALO_NURSE | DOCTOR | PATIENT
  let custodian = 'ALO_NURSE';
  let nextActionEn = 'Nurse: Review documents & verify payment';
  let nextActionAr = 'الممرض: مراجعة المستندات وتأكيد الدفع';

  if (c.status === 'SUBMITTED' || c.status === 'INITIAL_REVIEW') {
    stage = 1;
    stageLabelEn = 'Case Received';
    stageLabelAr = 'استلام الحالة';
    custodian = 'ALO_NURSE';
    if (!c.payment_confirmed) {
      nextActionEn = 'Confirm payment & review submitted documents';
      nextActionAr = 'تأكيد الدفع ومراجعة المستندات المقدمة';
    } else {
      nextActionEn = 'Complete nurse check & select consultant';
      nextActionAr = 'إكمال فحص الممرض واختيار المختص';
    }
  } else if (c.status === 'ADDITIONAL_INFO_REQUIRED') {
    stage = 2;
    stageLabelEn = 'Awaiting Documents';
    stageLabelAr = 'بانتظار المستندات';
    custodian = 'PATIENT';
    nextActionEn = 'Patient must upload requested medical reports';
    nextActionAr = 'يجب على المريض رفع التقارير الطبية المطلوبة';
  } else if (c.status === 'READY_FOR_ASSIGNMENT') {
    if (c.intake_completed) {
      stage = 2;
      stageLabelEn = 'Nurse Check Complete';
      stageLabelAr = 'اكتمل فحص الممرض';
      custodian = 'ALO_NURSE';
      nextActionEn = 'Select consultant & send Magic Link 👉';
      nextActionAr = 'اختر المختص وأرسل الرابط 👉';
    } else {
      stage = 1;
      stageLabelEn = 'Ready for Nurse Check';
      stageLabelAr = 'جاهز لفحص الممرض';
      custodian = 'ALO_NURSE';
      nextActionEn = 'Nurse: Verify documents & vitals';
      nextActionAr = 'الممرض: التحقق من المستندات والعلامات الحيوية';
    }
  } else if (c.status === 'SPECIALIST_ASSIGNED') {
    const hasNurse = c.owner_role === 'nurse' || (c.assignments || []).some(a => a.role === 'nurse');
    const hasDoctor = c.owner_role === 'doctor' || (c.assignments || []).some(a => a.role === 'doctor') || (c.magic_links || []).length > 0;

    if (hasNurse && !c.intake_completed) {
      stage = 2;
      stageLabelEn = 'Nurse Review';
      stageLabelAr = 'مراجعة الممرض';
      custodian = 'ALO_NURSE';
      nextActionEn = 'Nurse reviewing reports & recording vitals';
      nextActionAr = 'الممرض يراجع التقارير ويسجل العلامات الحيوية';
    } else if (hasDoctor || c.intake_completed) {
      stage = 3;
      stageLabelEn = 'Consultant Review';
      stageLabelAr = 'مراجعة المختص';
      custodian = 'DOCTOR';
      nextActionEn = 'Consultant reviewing case & preparing opinion';
      nextActionAr = 'المختص يدرس الحالة ويعد الرأي الطبي';
    } else {
      stage = 2;
      stageLabelEn = 'Specialist Assigned';
      stageLabelAr = 'تم تعيين المختص';
      custodian = 'ALO_NURSE';
      nextActionEn = 'Nurse managing consultant review';
      nextActionAr = 'الممرض يتابع المراجعة الطبية';
    }
  } else if (c.status === 'UNDER_MEDICAL_REVIEW' || c.status === 'IN_PROGRESS' || c.status === 'APPOINTMENT_SCHEDULED') {
    stage = 3;
    stageLabelEn = 'Under Medical Review';
    stageLabelAr = 'قيد المراجعة الطبية';
    custodian = 'DOCTOR';
    nextActionEn = 'Consultant conducting review / writing report';
    nextActionAr = 'المختص يجري المراجعة ويكتب التقرير';
  } else if (c.status === 'REPORT_SUBMITTED') {
    stage = 4;
    stageLabelEn = 'Opinion Prepared';
    stageLabelAr = 'تم إعداد الرأي الطبي';
    custodian = 'ALO_NURSE';
    nextActionEn = 'Consultant submitted opinion 👉 Nurse to release report to patient';
    nextActionAr = 'المختص سلم الرأي الطبي 👉 الممرض يعتمد ويرسل التقرير للمريض';
  } else if (c.status === 'COMPLETED') {
    stage = 5;
    stageLabelEn = 'Delivered & Complete';
    stageLabelAr = 'مكتملة ومسلمة للمريض';
    custodian = 'PATIENT';
    nextActionEn = 'Final medical opinion released. Available for download.';
    nextActionAr = 'تم نشر الرأي الطبي النهائي. متاح للتحميل.';
  } else if (c.status === 'FOLLOW_UP') {
    stage = 5;
    stageLabelEn = 'Follow-up Recommended';
    stageLabelAr = 'يوصى بمتابعة';
    custodian = 'PATIENT';
    nextActionEn = 'Follow-up consultation recommended by physician';
    nextActionAr = 'يوصي الطبيب باستشارة متابعة';
  } else if (c.status === 'CANCELLED') {
    stage = 0;
    stageLabelEn = 'Cancelled';
    stageLabelAr = 'ملغاة';
    custodian = 'ALO_NURSE';
    nextActionEn = 'Case cancelled';
    nextActionAr = 'تم إلغاء الحالة';
  }

  const stages = [
    {
      step: 1,
      key: 'RECEIVED',
      titleEn: 'Case Received',
      titleAr: 'استلام الحالة',
      descEn: 'Records submitted',
      descAr: 'تم تقديم المستندات',
      isCompleted: stage > 1,
      isCurrent: stage === 1
    },
    {
      step: 2,
      key: 'TRIAGE',
      titleEn: 'Nurse Triage',
      titleAr: 'فرز التمريض',
      descEn: 'Docs & vitals check',
      descAr: 'فحص المستندات والبيانات',
      isCompleted: stage > 2,
      isCurrent: stage === 2,
      isBlocked: c.status === 'ADDITIONAL_INFO_REQUIRED'
    },
    {
      step: 3,
      key: 'REVIEW',
      titleEn: 'Doctor Review',
      titleAr: 'مراجعة الطبيب',
      descEn: 'Specialist analysis',
      descAr: 'دراسة وتحليل المختص',
      isCompleted: stage > 3,
      isCurrent: stage === 3
    },
    {
      step: 4,
      key: 'OPINION',
      titleEn: 'Opinion Prepared',
      titleAr: 'إعداد الرأي',
      descEn: 'Drafting report',
      descAr: 'إعداد التقرير الطبي',
      isCompleted: stage > 4,
      isCurrent: stage === 4
    },
    {
      step: 5,
      key: 'DELIVERED',
      titleEn: 'Delivered',
      titleAr: 'اكتمال الحالة',
      descEn: 'Final opinion ready',
      descAr: 'التقرير النهائي جاهز',
      isCompleted: stage === 5,
      isCurrent: stage === 5
    }
  ];

  return {
    is_written_opinion: isWrittenOpinion,
    stage,
    stage_label: lang === 'ar' ? stageLabelAr : stageLabelEn,
    custodian,
    next_action: lang === 'ar' ? nextActionAr : nextActionEn,
    next_action_en: nextActionEn,
    next_action_ar: nextActionAr,
    is_blocked: c.status === 'ADDITIONAL_INFO_REQUIRED',
    stages
  };
}
