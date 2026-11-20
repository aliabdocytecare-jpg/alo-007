import axios from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });
export const errMsg = e => e.response?.data?.error || e.message || 'Something went wrong';
export const fmtDate = d => (d ? new Date(d).toLocaleString() : '—');
export const fmtDay = d => (d ? new Date(d).toLocaleDateString() : '—');