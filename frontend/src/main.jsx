import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from '@/context/AppContext';
import { ToastProvider } from '@/context/ToastContext';

import '@/styles/app.css';
import '@/styles/sidebar.css';
import '@/styles/boncaisse.css';
import '@/styles/initialisation.css';
import '@/styles/responsive.css';
import '@/styles/nj-business.css';
import '@/styles/projets.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>
);
