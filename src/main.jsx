import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Kyvro -> Dorzi (Nov 2026): this browser's saved data (cart, saved items, shop link, language …) used "kyvro_" key
// names. Move them to "dorzi_" once, before the app reads them, so nobody loses their cart.
try {
  for (const st of [window.localStorage, window.sessionStorage]) {
    for (let i = st.length - 1; i >= 0; i -= 1) {
      const k = st.key(i);
      if (k && k.startsWith('kyvro_')) {
        const n = `dorzi_${k.slice(6)}`;
        if (st.getItem(n) === null) st.setItem(n, st.getItem(k));
        st.removeItem(k);
      }
    }
  }
} catch (e) { /* storage blocked: nothing to move */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
