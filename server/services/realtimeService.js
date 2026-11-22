// DEC-062: Real-time Event Broadcaster for Hospital Clinic Queues & Displays
import EventEmitter from 'events';

class QueueEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

export const queueEvents = new QueueEventEmitter();

/**
 * Broadcasts a queue update event to all active SSE/WebSocket listeners for a hospital
 */
export function emitQueueUpdate(hospitalId, detail = {}) {
  if (!hospitalId) return;
  queueEvents.emit('queue_update', {
    hospitalId,
    timestamp: new Date().toISOString(),
    ...detail
  });
}
