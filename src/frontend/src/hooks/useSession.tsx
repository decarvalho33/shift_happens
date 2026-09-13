import { useState, type ReactNode } from 'react';
import type { Role } from '../types';
import { SessionContext } from './session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(() => {
    try {
      const saved = sessionStorage.getItem('enter-policy-role');
      return saved === 'ADVOGADO' || saved === 'ADMINISTRATIVO' ? saved : null;
    } catch {
      return null;
    }
  });
  const login = (next: Role) => {
    setRole(next);
    try {
      sessionStorage.setItem('enter-policy-role', next);
    } catch {
      /* Session still works in memory. */
    }
  };
  const logout = () => {
    setRole(null);
    try {
      sessionStorage.removeItem('enter-policy-role');
    } catch {
      /* No durable authentication is used. */
    }
  };
  return (
    <SessionContext.Provider value={{ role, login, logout }}>{children}</SessionContext.Provider>
  );
}
