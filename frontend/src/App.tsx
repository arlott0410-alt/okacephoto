import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import UploadPage from "./pages/UploadPage";
import GalleryPage from "./pages/GalleryPage";
import FoldersPage from "./pages/FoldersPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, loggedIn } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="container">Loading…</div>;
  if (!loggedIn) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function TopBar() {
  const { logout, loggedIn } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.body.classList.toggle("theme-light", theme === "light");
  }, [theme]);

  return (
    <div className="topbar">
      <div className="brand">
        <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--accent)", display: "inline-block" }} />
        <span>okacephoto</span>
        <span className="pill">Admin</span>
      </div>
      <div className="row">
        <nav className="row" style={{ gap: 8 }}>
          <NavLink className="btn" to="/app/upload" end style={({ isActive }) => (isActive ? { borderColor: "var(--accent)" } : undefined)}>
            Upload
          </NavLink>
          <NavLink className="btn" to="/app/gallery" end={false} style={({ isActive }) => (isActive ? { borderColor: "var(--accent)" } : undefined)}>
            Gallery
          </NavLink>
          <NavLink className="btn" to="/app/folders" end style={({ isActive }) => (isActive ? { borderColor: "var(--accent)" } : undefined)}>
            Folders
          </NavLink>
        </nav>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as any)}
          style={{ width: 160, padding: "8px 10px", borderRadius: 12 }}
          aria-label="Theme"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        {loggedIn ? (
          <button
            className="btn"
            onClick={async () => {
              await logout();
            }}
          >
            Logout
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AppShell() {
  return (
    <>
      <div className="container">
        <TopBar />
      </div>
      <div className="container">
        <Routes>
          <Route
            path="/app/upload"
            element={
              <RequireAuth>
                <UploadPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/gallery"
            element={
              <RequireAuth>
                <GalleryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/app/folders"
            element={
              <RequireAuth>
                <FoldersPage />
              </RequireAuth>
            }
          />
          <Route path="/app" element={<Navigate to="/app/upload" replace />} />
        </Routes>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<AppShell />} />
      </Routes>
    </AuthProvider>
  );
}

