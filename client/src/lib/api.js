import axios from 'axios';

// DEC-047: split hosting (Cloudflare Pages frontend + separate API origin).
// Dev / same-origin uses the relative path (Vite proxy); production sets VITE_API_URL
// to the absolute API base, e.g. https://api.alodoc.online/api/v1.
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api/v1', withCredentials: true });
export const errMsg = e => e.response?.data?.error || e.message || 'Something went wrong';
export const fmtDate = d => (d ? new Date(d).toLocaleString() : '—');
export const fmtDay = d => (d ? new Date(d).toLocaleDateString() : '—');