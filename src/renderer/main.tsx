import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadInitialData } from './store';
import { startSyncRuntime } from './syncRuntime';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import './styles.css';
import './theme-aurora.css';

// Windows has the custom title bar; Linux keeps its native window frame.
document.documentElement.classList.add(`platform-${window.rlj?.platform ?? 'win32'}`);

createRoot(document.getElementById('root')!).render(<App />);

loadInitialData().then(() => startSyncRuntime());
