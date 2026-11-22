// DEC-056: Hospital Slot Generation & Lifecycle Management
import { db } from '../config/db.js';

export const DEFAULT_HORIZON_DAYS = 14;
export const DEFAULT_RELEASE_HOURS = 24;

/**
 * Generates slots for all active slot templates of a hospital up to horizonDays
 */
export async function generateSlotsForHospital(hospitalId, { horizonDays = DEFAULT_HORIZON_DAYS, doctorId = null } = {}) {
  let query = db.from('hospital_slot_templates')
    .select('*')
    .eq('hospital_id', hospitalId)
    .eq('active', true);

  if (doctorId) {
    query = query.eq('doctor_id', doctorId);
  }

  const { data: templates, error } = await query;
  if (error || !templates || !templates.length) return { generated: 0 };

  let totalInserted = 0;
  const today = new Date();

  for (const t of templates) {
    const slotsToInsert = [];

    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
      const d = new Date(today);
      d.setDate(today.getDate() + dayOffset);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, etc.

      // Check validity window
      if (t.valid_from && dateStr < t.valid_from) continue;
      if (t.valid_to && dateStr > t.valid_to) continue;

      if (!t.weekdays || !t.weekdays.includes(dayOfWeek)) continue;

      for (const timeStr of (t.times || [])) {
        slotsToInsert.push({
          hospital_id: hospitalId,
          doctor_id: t.doctor_id,
          date: dateStr,
          time: timeStr,
          duration_min: t.duration_min || 30,
          status: 'free'
        });
      }
    }

    if (slotsToInsert.length) {
      // Upsert ignoring conflict on (hospital_id, doctor_id, date, time)
      const { data: inserted, error: insErr } = await db
        .from('hospital_slots')
        .upsert(slotsToInsert, { onConflict: 'hospital_id,doctor_id,date,time', ignoreDuplicates: true })
        .select('id');

      if (!insErr && inserted) {
        totalInserted += inserted.length;
      }
    }
  }

  return { generated: totalInserted };
}

/**
 * Sweep free slots approaching within releaseHours into 'released' status
 */
export async function releaseExpiredFreeSlots({ releaseHours = DEFAULT_RELEASE_HOURS } = {}) {
  const now = new Date();
  const threshold = new Date(now.getTime() + releaseHours * 3600_000);
  const dateStr = threshold.toISOString().split('T')[0];

  const { data: candidateSlots, error } = await db
    .from('hospital_slots')
    .select('id, date, time')
    .eq('status', 'free')
    .lte('date', dateStr);

  if (error || !candidateSlots || !candidateSlots.length) return { released: 0 };

  const idsToRelease = [];
  for (const s of candidateSlots) {
    const slotTimeMs = new Date(`${s.date}T${s.time}:00`).getTime();
    if (slotTimeMs <= threshold.getTime()) {
      idsToRelease.push(s.id);
    }
  }

  if (idsToRelease.length) {
    await db.from('hospital_slots')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .in('id', idsToRelease);
  }

  return { released: idsToRelease.length };
}
