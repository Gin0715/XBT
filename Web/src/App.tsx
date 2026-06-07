import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Login from './pages/Login';
import Lobby from './pages/Lobby';
import Courses from './pages/Courses';
import SignDetail from './pages/SignDetail';
import Whitelist from './pages/Whitelist';
import AccountManagement from './pages/AccountManagement';
import FullScanner from './pages/FullScanner';
import Quiz from './pages/Quiz';
import ProtectedRoute from './components/ProtectedRoute';
import { useEffect } from 'react';

function App() {
  useEffect(() => {
    const preventPagePinch = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
      }
    };
    const preventGesture = (event: Event) => event.preventDefault();
    document.addEventListener('touchmove', preventPagePinch, { passive: false });
    document.addEventListener('gesturestart', preventGesture as EventListener, { passive: false } as AddEventListenerOptions);
    document.addEventListener('gesturechange', preventGesture as EventListener, { passive: false } as AddEventListenerOptions);
    return () => {
      document.removeEventListener('touchmove', preventPagePinch as EventListener);
      document.removeEventListener('gesturestart', preventGesture as EventListener);
      document.removeEventListener('gesturechange', preventGesture as EventListener);
    };
  }, []);

  return (
    <HashRouter>
      <Toaster
        position="top-center"
        reverseOrder={false}
        containerStyle={{
          top: 'calc(24px + var(--sat))',
        }}
        toastOptions={{
          style: {
            borderRadius: '16px',
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            color: '#1E293B',
            fontSize: '14px',
            fontWeight: '600',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
            padding: '14px 22px',
            maxWidth: '90%',
            border: '1px solid rgba(226,232,240,0.6)',
          },
          success: {
            iconTheme: {
              primary: '#00B42A',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#F53F3F',
              secondary: '#fff',
            },
          },
        }}
      />
      <div className="h-screen h-[100dvh] text-text-primary font-sans selection:bg-brand-100 overflow-hidden min-h-0 relative">
        {/* Background gradient with subtle texture */}
        <div className="fixed inset-0 -z-10 pointer-events-none" style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)',
        }} />
        {/* Decorative accent blobs */}
        <div className="fixed -top-32 -right-32 w-96 h-96 rounded-full -z-10 pointer-events-none" style={{
          background: 'radial-gradient(circle, rgba(22,93,255,0.06) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        <div className="fixed -bottom-24 -left-24 w-80 h-80 rounded-full -z-10 pointer-events-none" style={{
          background: 'radial-gradient(circle, rgba(114,46,209,0.05) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />

        <div className="w-full sm:max-w-[420px] mx-auto h-full relative flex flex-col overflow-hidden min-h-0 sm:border-x"
          style={{
            boxShadow: '0 0 0 1px rgba(226,232,240,0.4), 0 4px 40px rgba(0,0,0,0.06)',
            background: 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Lobby />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/sign/:id" element={<SignDetail />} />
              <Route path="/admin/whitelist" element={<Whitelist />} />
              <Route path="/accounts" element={<AccountManagement />} />
              <Route path="/scanner" element={<FullScanner />} />
              <Route path="/quiz" element={<Quiz />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}

export default App;
