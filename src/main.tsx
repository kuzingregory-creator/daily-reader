import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { requestPersistence } from './store/backup';
import './styles.css';

// Offline cache; a new version takes over on the next launch.
registerSW({ immediate: true });
// Ask Safari not to clear this app's data when the phone is short of space.
requestPersistence();

render(<App />, document.getElementById('app')!);
