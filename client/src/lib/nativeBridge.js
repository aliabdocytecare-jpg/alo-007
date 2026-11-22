/**
 * Native Bridge for AloDoc Mobile (Rork Native iOS / Android Shell)
 * Provides unified bidirectional communication between embedded WebViews and native Swift/Kotlin handlers.
 */
export const NativeBridge = {
  isNativeApp() {
    return typeof window !== 'undefined' && Boolean(
      window.webkit?.messageHandlers?.aloBridge ||
      window.AndroidBridge ||
      window.ALO_PLATFORM
    );
  },

  getPlatform() {
    if (typeof window === 'undefined') return 'web';
    if (window.webkit?.messageHandlers?.aloBridge) return 'ios';
    if (window.AndroidBridge) return 'android';
    if (window.ALO_PLATFORM) return window.ALO_PLATFORM;
    return 'web';
  },

  // Post message to native host
  postMessage(action, payload = {}) {
    if (typeof window === 'undefined') return false;
    const msg = { action, ...payload, timestamp: Date.now() };

    // iOS WKScriptMessageHandler
    if (window.webkit?.messageHandlers?.aloBridge?.postMessage) {
      window.webkit.messageHandlers.aloBridge.postMessage(msg);
      return true;
    }

    // Android JavascriptInterface
    if (window.AndroidBridge?.postMessage) {
      window.AndroidBridge.postMessage(JSON.stringify(msg));
      return true;
    }

    return false;
  },

  // Trigger device haptic / vibration feedback
  triggerHaptic(type = 'medium') {
    const handled = this.postMessage('haptic', { type });
    if (!handled && typeof navigator !== 'undefined' && navigator.vibrate) {
      if (type === 'heavy') navigator.vibrate([150, 50, 150]);
      else if (type === 'light') navigator.vibrate(40);
      else navigator.vibrate(80);
    }
  },

  // Request native camera scan
  requestCameraScan(purpose = 'barcode') {
    return new Promise((resolve) => {
      const handled = this.postMessage('scan_request', { purpose });
      if (!handled) {
        // Fallback for desktop / web browser
        const code = window.prompt('Enter or scan barcode:');
        resolve(code ? code.trim() : null);
        return;
      }
      // Listen for one-time native callback
      const onScanResult = (event) => {
        window.removeEventListener('alo:scan_result', onScanResult);
        resolve(event.detail?.code || null);
      };
      window.addEventListener('alo:scan_result', onScanResult, { once: true });
    });
  },

  // Notify native shell that patient ticket was called
  notifyTicketCalled(ticketData) {
    this.postMessage('ticket_called', ticketData);
    this.triggerHaptic('heavy');
  },

  // Sync token from native shell to web session
  setAuthToken(token) {
    if (typeof window !== 'undefined' && token) {
      localStorage.setItem('alodoc_token', token);
      window.ALO_TOKEN = token;
    }
  },

  // Clear stored auth token on logout
  clearAuthToken() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('alodoc_token');
      delete window.ALO_TOKEN;
    }
    this.postMessage('logout');
  }
};
