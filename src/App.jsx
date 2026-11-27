import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { DriveStoreProvider, useDrive } from './store/DriveStore';
import { UIProvider } from './store/UIContext';
import { UploadProvider } from './store/UploadContext';
import { setDateMode, setTimeZone } from './utils/format';
import Indexer from './search/Indexer';
import AppLayout from './components/layout/AppLayout';
import FolderView from './views/FolderView';
import { MyFilesView, SharedWithMeView, SharedByMeView, RecentView, FavoritesView, TrashView } from './views/ListViews';
import { EmptyState } from './components/common';
import { safeNext } from './utils/safeNext';
import { lazyNamed } from './utils/lazy';
import ErrorBoundary from './components/common/ErrorBoundary';

// Screens that aren't needed to show the file list load on first visit (keeps the first download small).
const PublicLinkView = lazyNamed(() => import('./views/PublicViews'), 'PublicLinkView');
const FileRequestView = lazyNamed(() => import('./views/PublicViews'), 'FileRequestView');
const FileRequestsView = lazyNamed(() => import('./views/FileRequestsView'));
const TasksView = lazyNamed(() => import('./views/WorkViews'), 'TasksView');
const ApprovalsView = lazyNamed(() => import('./views/WorkViews'), 'ApprovalsView');
const ActivityView = lazyNamed(() => import('./views/WorkViews'), 'ActivityView');
const TeamFoldersView = lazyNamed(() => import('./views/TeamFoldersView'));
const SearchView = lazyNamed(() => import('./views/SearchView'));
const TemplatesView = lazyNamed(() => import('./views/TemplatesView'));
const SettingsView = lazyNamed(() => import('./views/SettingsView'));
const AdminView = lazyNamed(() => import('./views/AdminView'));
const LoginView = lazyNamed(() => import('./views/LoginView'));
const SignaturesView = lazyNamed(() => import('./signatures/SignaturesView'));
const PublicSignView = lazyNamed(() => import('./signatures/SignaturesView'), 'PublicSignView');
const EmbedView = lazyNamed(() => import('./sharing/EmbedView'));

/** Shown for the moment a screen's code is loading. */
function ScreenLoading() {
  return <div className="screen-loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> <span className="sr-only">Loading…</span></div>;
}

/** Applies theme + density to the document root. */
function ThemeSync() {
  const { state } = useDrive();
  const { theme, density, dateFormat, timeZone } = state.settings;
  setDateMode(dateFormat);
  setTimeZone(timeZone);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      // default: light pages + navy sidebar · light: light pages + light sidebar · dark: everything dark.
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.sidebar = !dark && theme !== 'light' ? 'navy' : 'plain';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset.density = density; }, [density]);
  return null;
}

function NotFound() {
  return <div className="page"><EmptyState icon={Compass} title="Page not found" text="The page you're looking for doesn't exist." action={<Link to="/folders" className="btn btn-primary">Go to My Folders</Link>} /></div>;
}

function Shell() {
  const { state } = useDrive();
  const location = useLocation();
  const onLogin = location.pathname === '/login';
  // Shared links and file requests are opened by people outside the app, so they work signed out too.
  if (/^\/(link|request|embed)\/[^/]+\/?$/.test(location.pathname) || /^\/sign\/[^/]+\/[^/]+\/?$/.test(location.pathname)) {
    return (
      <ErrorBoundary variant="public" resetKey={location.pathname}>
      <Suspense fallback={<ScreenLoading />}>
      <Routes>
        <Route path="link/:id" element={<PublicLinkView />} />
        <Route path="request/:id" element={<FileRequestView />} />
        <Route path="embed/:id" element={<EmbedView />} />
        <Route path="sign/:requestId/:signerId" element={<PublicSignView />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    );
  }
  if (state.signedOut && !onLogin) {
    const here = location.pathname + location.search;
    return <Navigate to={here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`} replace />;
  }
  if (!state.signedOut && onLogin) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={safeNext(next)} replace />;
  }
  // Screens inside the app frame have their own boundary (AppLayout); this one catches the frame itself and the login page.
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Suspense fallback={<ScreenLoading />}>
    <Routes>
      <Route path="login" element={<LoginView />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/folders" replace />} />
        <Route path="folders" element={<FolderView mode="my" />} />
        <Route path="folders/:folderId" element={<FolderView mode="my" />} />
        <Route path="team-folders" element={<TeamFoldersView />} />
        <Route path="team-folders/:teamId" element={<FolderView mode="team" />} />
        <Route path="team-folders/:teamId/:folderId" element={<FolderView mode="team" />} />
        <Route path="my-files" element={<MyFilesView />} />
        <Route path="shared-with-me" element={<SharedWithMeView />} />
        <Route path="shared-by-me" element={<SharedByMeView />} />
        <Route path="recent" element={<RecentView />} />
        <Route path="favorites" element={<FavoritesView />} />
        <Route path="trash" element={<TrashView />} />
        <Route path="templates" element={<TemplatesView />} />
        <Route path="search" element={<SearchView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="settings/:tab" element={<SettingsView />} />
        <Route path="admin" element={<AdminView />} />
        <Route path="admin/:tab" element={<AdminView />} />
        <Route path="file-requests" element={<FileRequestsView />} />
        <Route path="tasks" element={<TasksView />} />
        <Route path="approvals" element={<ApprovalsView />} />
        <Route path="signatures" element={<SignaturesView />} />
        <Route path="activity" element={<ActivityView />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Last resort: even a crash in the app's providers shows a way out instead of a blank page. */}
      <ErrorBoundary variant="app">
      <DriveStoreProvider>
        <UIProvider>
          <UploadProvider>
            <ThemeSync />
            <Indexer />
            <Shell />
          </UploadProvider>
        </UIProvider>
      </DriveStoreProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
