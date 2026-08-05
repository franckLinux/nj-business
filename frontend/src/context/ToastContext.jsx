import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Reproduit le toast de l'app vanilla : même markup (<div class="toast">),
// mêmes classes de variante, même durée par défaut (3400 ms).
const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { msg, type }
  const timer = useRef(null);

  const show = useCallback((msg, type = '', duration = 3400) => {
    clearTimeout(timer.current);
    setToast({ msg, type });
    timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={'toast' + (toast.type ? ' ' + toast.type : '')} style={{ display: 'block' }}>
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
