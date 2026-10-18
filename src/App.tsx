import React, { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './components/auth/LoginPage';
import { AuthUser } from './types/pkp';
import { pkpStore } from './services/mockState';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const handleLoginSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    if (currentUser) {
      pkpStore.addAuditLog('Logout Pengguna', `Pengguna [${currentUser.username}] keluar dari sistem SIPKP`, currentUser.name);
    }
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <AppLayout 
      currentUser={currentUser} 
      onLogout={handleLogout} 
    />
  );
}

export default App;
