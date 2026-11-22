import axios from 'axios';

// DEC-047: split hosting (Cloudflare Pages frontend + separate API origin).
// Dev / same-origin uses the relative path (Vite proxy); production sets VITE_API_URL
// to the absolute API base, e.g. https://api.alodoc.online/api/v1.
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1', withCredentials: true });

// DEC-065: Attach Bearer token and mobile telemetry headers if present
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? (localStorage.getItem('alodoc_token') || window.ALO_TOKEN) : null;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const platform = typeof window !== 'undefined' ? (window.ALO_PLATFORM || (window.webkit?.messageHandlers?.aloBridge ? 'ios' : null)) : null;
  if (platform && !config.headers['X-Client-Platform']) {
    config.headers['X-Client-Platform'] = platform;
  }
  return config;
});

export const errMsg = e => e.response?.data?.error || e.message || 'Something went wrong';
export const errCode = e => e.response?.data?.code || null;
export const fmtDate = d => (d ? new Date(d).toLocaleString() : '—');
export const fmtDay = d => (d ? new Date(d).toLocaleDateString() : '—');