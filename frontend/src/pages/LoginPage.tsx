import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();

  const from = (loc.state as any)?.from ? String((loc.state as any).from) : "/app/upload";

  const canSubmit = useMemo(() => password.trim().length > 0 && !busy && !loading, [password, busy, loading]);

  return (
    <div className="container">
      <div className="card">
        <div className="card-inner">
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Admin Login</div>
          <div className="muted" style={{ marginBottom: 16 }}>
            Enter the shared password to upload and manage images.
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canSubmit) return;
              setBusy(true);
              try {
                await login(password);
                navigate(from, { replace: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label>Shared password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <div style={{ color: "var(--danger)", marginBottom: 12, fontSize: 13 }}>{error}</div>
            ) : null}

            <button className="btn btn-accent" type="submit" disabled={!canSubmit}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

