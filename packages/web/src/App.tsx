import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { CharacterSelect } from './pages/CharacterSelect.js';
import { Game } from './pages/Game.js';
import { Home } from './pages/Home.js';

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-header">
          <Link to="/" className="brand">
            LoreForge
          </Link>
          <span className="brand-sub">AI-narrated adventures</span>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/start/:adventureId" element={<CharacterSelect />} />
            <Route path="/play/:code" element={<Game />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
