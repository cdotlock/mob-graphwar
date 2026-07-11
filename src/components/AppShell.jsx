import React, { useEffect } from "react";
import { BookOpen, Languages, LogIn, Swords, Trophy, UserRound } from "lucide-react";
import { t } from "../lib/i18n.js";

const destinations = [
  { id: "play", icon: Swords, label: "play" },
  { id: "leaderboard", icon: Trophy, label: "leaderboard" },
  { id: "api", icon: BookOpen, label: "apiDocs" }
];

export function AppShell({ locale, activePage, onNavigate, onToggleLocale, profile, onOpenAuth, onLogout, children }) {
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand-button" onClick={() => onNavigate("play")} aria-label="Mob Graphwar Arena">
          <span className="brand-mark"><Swords size={18} /></span>
          <span><strong>Mob Graphwar</strong><small>AI Function Arena</small></span>
        </button>
        <nav className="primary-nav" aria-label="Primary">
          {destinations.map(({ id, icon: Icon, label }) => (
            <button key={id} className={activePage === id ? "active" : ""} onClick={() => onNavigate(id)} aria-current={activePage === id ? "page" : undefined}>
              <Icon size={16} /> <span>{t(locale, label)}</span>
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="icon-command" onClick={onToggleLocale} title={t(locale, "language")} aria-label={t(locale, "language")}>
            <Languages size={17} /><span>{t(locale, "language")}</span>
          </button>
          {profile ? (
            <div className="account-menu">
              <button className="account-command" onClick={onOpenAuth} aria-label={t(locale, "account")}>
                <UserRound size={17} /><span>{profile.displayName}</span><b>{profile.rank?.rating || 1000}</b>
              </button>
              <button className="logout-command" onClick={onLogout} title={t(locale, "signOut")} aria-label={t(locale, "signOut")}>×</button>
            </div>
          ) : (
            <button className="account-command" onClick={onOpenAuth} aria-label={t(locale, "signIn")}><LogIn size={17} /><span>{t(locale, "signIn")}</span></button>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
