import { useState } from 'react';
import DevConsoleGate from './components/DevConsoleGate';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import TourOverlay from './components/TourOverlay';
import ActivityView from './views/ActivityView';
import ProfilesView from './views/ProfilesView';
import SettingsView from './views/SettingsView';
import SpooferView from './views/SpooferView';

export default function App() {
  const [currentView, setCurrentView] = useState('spoofer');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="app-shell">
      <Sidebar currentView={currentView} setCurrentView={setCurrentView} />

      <main className="content-shell">
        <TopBar toggleSidebar={() => setSidebarCollapsed((prev) => !prev)} />

        <section className="workspace" aria-label="Application content">
          <SpooferView isActive={currentView === 'spoofer'} />
          <ActivityView isActive={currentView === 'queue'} />
          <ProfilesView isActive={currentView === 'profiles'} />
          <SettingsView isActive={currentView === 'settings'} />
        </section>
      </main>

      <DevConsoleGate />
      <TourOverlay />
    </div>
  );
}
