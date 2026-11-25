import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { bootstrapModel } from './model/bootstrap.ts';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

bootstrapModel();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
