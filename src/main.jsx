import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/viewing.css';
import './styles/sharing.css';
import './styles/signatures.css';
import './styles/app-extra.css';
import './styles/viewer.css';
import './styles/quality.css';
import PwaChrome from './pwa/PwaChrome';
import { registerServiceWorker } from './pwa/register';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaChrome />
  </React.StrictMode>,
);

registerServiceWorker(); // production builds only
