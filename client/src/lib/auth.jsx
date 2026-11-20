import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const refresh = async () => {
    try {
      const { data } = await api.get('/auth/me');
      setSession(data);
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