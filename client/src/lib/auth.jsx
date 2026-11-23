import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const refresh = async () => {
    try {
      const { data } = await api.get('/auth/me');
      if (data) {
        const hospitalId = data.hospital_id || data.profile?.hospital_id || data.hospital?.id || null;
        const tenant = data.tenant || data.hospital || null;
        const staff = data.staff || data.profile || null;
        setSession({
          ...data,
          hospital_id: hospitalId,
          tenant,
          staff
        });
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    }
  };
  useEffect(() => { refresh(); }, []);
  const logout = async () => {
    await api.post('/auth/logout');
    setSession(null);
  };
  return <AuthCtx.Provider value={{ session, refresh, logout, setSession }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);