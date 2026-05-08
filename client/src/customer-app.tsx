import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './customer/App';
import './customer/customer-app.css';

const root = document.getElementById('customer-root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
