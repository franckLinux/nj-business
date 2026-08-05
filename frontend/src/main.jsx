import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from '@/context/AppContext';
import { ToastProvider } from '@/context/ToastContext';

// Source unique du style : la feuille de l'app vanilla est importée telle
// quelle, ce qui garantit un rendu identique entre / et /v2.
import '../../public/css/app.css';
import '@/styles/sidebar.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/v2">
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
