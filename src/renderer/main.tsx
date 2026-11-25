import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadInitialData } from './store';
import { startSyncRuntime } from './syncRuntime';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

loadInitialData().then(() => startSyncRuntime());
