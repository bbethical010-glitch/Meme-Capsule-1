import React, { useState } from "react";
import type { CuratorUser } from "./curateTypes";

interface CurateAccountModalProps {
  user: CuratorUser;
  onClose: () => void;
  onAccountUpdated: (updatedUser: CuratorUser) => void;
}

export default function CurateAccountModal({
  user,
  onClose,
  onAccountUpdated
}: CurateAccountModalProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  // Dedicated API Key Encryption Password State
  const [hasApiPassword, setHasApiPassword] = useState<boolean>(Boolean(user.has_api_password));
  const [currentApiPassword, setCurrentApiPassword] = useState("");
  const [newApiPassword, setNewApiPassword] = useState("");
  const [confirmApiPassword, setConfirmApiPassword] = useState("");
  const [showApiPasswords, setShowApiPasswords] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync live account status on mount
  React.useEffect(() => {
    const token = sessionStorage.getItem("curator_token");
    if (!token) return;
    fetch("/api/curate/account", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.user?.has_api_password !== undefined) {
          setHasApiPassword(Boolean(data.user.has_api_password));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Login password validations
    if (newPassword && newPassword !== confirmPassword) {
      setErrorMsg("New login passwords do not match.");
      return;
    }

    if (newPassword && newPassword.length < 6) {
      setErrorMsg("New login password must be at least 6 characters.");
      return;
    }

    if (newPassword && !currentPassword) {
      setErrorMsg("Current login password is required to set a new password.");
      return;
    }

    // API Key Encryption Password validations
    if (newApiPassword && newApiPassword !== confirmApiPassword) {
      setErrorMsg("New API encryption passwords do not match.");
      return;
    }

    if (newApiPassword && newApiPassword.length < 4) {
      setErrorMsg("New API encryption password must be at least 4 characters.");
      return;
    }

    if (newApiPassword && hasApiPassword && !currentApiPassword) {
      setErrorMsg("Current API encryption password is required to change it.");
      return;
    }

    const token = sessionStorage.getItem("curator_token");
    if (!token) {
      setErrorMsg("Session expired. Please log in again.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/curate/account", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          display_name: displayName.trim(),
          username: username.trim(),
          current_password: currentPassword || undefined,
          new_password: newPassword || undefined,
          current_api_password: currentApiPassword || undefined,
          new_api_password: newApiPassword || undefined
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Update failed with HTTP ${res.status}`);
      }

      const updated = data.user as CuratorUser;
      sessionStorage.setItem("curator_user", JSON.stringify(updated));
      onAccountUpdated(updated);

      if (data.user?.has_api_password !== undefined) {
        setHasApiPassword(Boolean(data.user.has_api_password));
      }

      setSuccessMsg("Account credentials and API security updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCurrentApiPassword("");
      setNewApiPassword("");
      setConfirmApiPassword("");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update account.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "20px"
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "500px",
          backgroundColor: "#1c1b1b",
          border: "2px solid #9b30ff",
          boxShadow: "6px 6px 0px #f4c300",
          padding: "28px",
          boxSizing: "border-box"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", borderBottom: "1px solid #333", paddingBottom: "12px" }}>
          <div>
            <h2 className="curate-anton" style={{ fontSize: "22px", color: "#f4c300", margin: 0 }}>
              JUDGE ACCOUNT SETTINGS
            </h2>
            <span style={{ fontSize: "11px", color: "#888", fontFamily: "monospace" }}>
              ID: {user.id} · Role: {user.role.toUpperCase()}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#aaa",
              fontSize: "20px",
              cursor: "pointer"
            }}
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Display Name */}
          <div>
            <label style={{ display: "block", fontFamily: "Oswald", fontSize: "12px", color: "#aaa", marginBottom: "4px" }}>
              DISPLAY NAME:
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "#121212",
                border: "1px solid #444",
                color: "#fff",
                fontFamily: "Oswald",
                fontSize: "14px",
                outline: "none"
              }}
            />
          </div>

          {/* Username */}
          <div>
            <label style={{ display: "block", fontFamily: "Oswald", fontSize: "12px", color: "#aaa", marginBottom: "4px" }}>
              USERNAME:
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "#121212",
                border: "1px solid #444",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: "13px",
                outline: "none"
              }}
            />
          </div>

          {/* Password Section */}
          <div style={{ borderTop: "1px solid #282828", paddingTop: "14px", marginTop: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span className="curate-anton" style={{ fontSize: "14px", color: "#9b30ff" }}>
                CHANGE PASSWORD (OPTIONAL)
              </span>
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f4c300",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontFamily: "Oswald"
                }}
              >
                {showPasswords ? "HIDE" : "SHOW"} PASSWORDS
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                  CURRENT PASSWORD:
                </label>
                <input
                  type={showPasswords ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required only if changing password"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "#121212",
                    border: "1px solid #444",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    outline: "none"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                  NEW PASSWORD:
                </label>
                <input
                  type={showPasswords ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "#121212",
                    border: "1px solid #444",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    outline: "none"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                  CONFIRM NEW PASSWORD:
                </label>
                <input
                  type={showPasswords ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "#121212",
                    border: "1px solid #444",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    outline: "none"
                  }}
                />
              </div>
            </div>
          </div>

          {/* Dedicated API Key Encryption Password Section */}
          <div style={{ borderTop: "2px solid #333", paddingTop: "14px", marginTop: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className="curate-anton" style={{ fontSize: "14px", color: "#34C759" }}>
                  API KEY ENCRYPTION PASSWORD
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    padding: "2px 6px",
                    background: hasApiPassword ? "rgba(52, 199, 89, 0.2)" : "rgba(255, 149, 0, 0.2)",
                    color: hasApiPassword ? "#34C759" : "#FF9500",
                    border: `1px solid ${hasApiPassword ? "#34C759" : "#FF9500"}`,
                    fontFamily: "Oswald",
                    fontWeight: 700
                  }}
                >
                  {hasApiPassword ? "PROTECTED (ACTIVE)" : "NOT CONFIGURED"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowApiPasswords(!showApiPasswords)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f4c300",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontFamily: "Oswald"
                }}
              >
                {showApiPasswords ? "HIDE" : "SHOW"} PASSWORDS
              </button>
            </div>

            <p style={{ fontSize: "11px", color: "#888", margin: "0 0 10px 0", lineHeight: "1.4" }}>
              Protects personal AI API keys when sharing your judge account with colleagues. Colleagues can toggle presets, switch models, add new models, and run AI batch judging without passwords, but cannot reveal keys, create, edit, or delete presets without this encryption password.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {hasApiPassword && (
                <div>
                  <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                    CURRENT API ENCRYPTION PASSWORD:
                  </label>
                  <input
                    type={showApiPasswords ? "text" : "password"}
                    value={currentApiPassword}
                    onChange={(e) => setCurrentApiPassword(e.target.value)}
                    placeholder="Required to change API password"
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      background: "#121212",
                      border: "1px solid #444",
                      color: "#fff",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      outline: "none"
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                  {hasApiPassword ? "NEW API ENCRYPTION PASSWORD:" : "SET API ENCRYPTION PASSWORD:"}
                </label>
                <input
                  type={showApiPasswords ? "text" : "password"}
                  value={newApiPassword}
                  onChange={(e) => setNewApiPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "#121212",
                    border: "1px solid #444",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    outline: "none"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontFamily: "Oswald", fontSize: "11px", color: "#888", marginBottom: "3px" }}>
                  CONFIRM API ENCRYPTION PASSWORD:
                </label>
                <input
                  type={showApiPasswords ? "text" : "password"}
                  value={confirmApiPassword}
                  onChange={(e) => setConfirmApiPassword(e.target.value)}
                  placeholder="Re-enter API encryption password"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "#121212",
                    border: "1px solid #444",
                    color: "#fff",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    outline: "none"
                  }}
                />
              </div>
            </div>
          </div>

          {/* Feedback messages */}
          {errorMsg && (
            <div style={{ background: "rgba(255, 59, 48, 0.15)", border: "1px solid #FF3B30", color: "#FF3B30", padding: "8px 12px", fontSize: "12px", fontFamily: "Oswald" }}>
              ✕ {errorMsg}
            </div>
          )}

          {successMsg && (
            <div style={{ background: "rgba(52, 199, 89, 0.15)", border: "1px solid #34C759", color: "#34C759", padding: "8px 12px", fontSize: "12px", fontFamily: "Oswald" }}>
              ✓ {successMsg}
            </div>
          )}

          {/* Form Actions */}
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 1,
                padding: "10px",
                background: "#f4c300",
                color: "#121212",
                border: "2px solid black",
                boxShadow: "2px 2px 0px black",
                fontFamily: "var(--font-display, 'Anton', sans-serif)",
                fontSize: "16px",
                cursor: saving ? "wait" : "pointer"
              }}
            >
              {saving ? "SAVING CHANGES..." : "SAVE ACCOUNT CHANGES"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: "10px 18px",
                background: "#262626",
                color: "#ddd",
                border: "1px solid #444",
                fontFamily: "Oswald",
                fontSize: "13px",
                cursor: "pointer"
              }}
            >
              CLOSE
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
