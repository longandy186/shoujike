import { useState, useEffect } from 'react';
import GuestPage from './pages/Guest/GuestPage';
import StaffPage from './pages/Staff/StaffPage';

/**
 * 简易路由 — MVP 阶段不引入 react-router
 * #/staff  → 店员后台
 * 其他      → 游客 H5
 */
function App() {
  const [page, setPage] = useState<'guest' | 'staff'>('guest');

  useEffect(() => {
    const update = () => {
      setPage(window.location.hash === '#/staff' ? 'staff' : 'guest');
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  return page === 'staff' ? <StaffPage /> : <GuestPage />;
}

export default App;
