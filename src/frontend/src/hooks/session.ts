import { createContext, useContext } from 'react';
import type { Role } from '../types';

interface SessionContextValue {
  role: Role | null;
  login: (role: Role) => void;
  logout: () => void;
}
export const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider ausente');
  return session;
}
