import React, { useLayoutEffect, useRef } from "react";
import { LogIn, X } from "lucide-react";
import { t } from "../lib/i18n.js";

export function AuthModal({ open, locale, mode, values, busy, error, onModeChange, onChange, onSubmit, onClose }) {
  const modalRef = useRef(null);
  const openerRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    const modal = modalRef.current;
    const focusables = () => Array.from(modal?.querySelectorAll("button, input") || []).filter((item) => !item.disabled);
    modal?.querySelector("input")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" ref={modalRef}>
        <div className="modal-heading">
          <div><LogIn size={19} /><span><strong id="auth-title">{mode === "login" ? t(locale, "login") : t(locale, "register")}</strong><small>Mob Graphwar ranked account</small></span></div>
          <button className="modal-close" onClick={onClose} aria-label={t(locale, "close")}><X size={18} /></button>
        </div>
        <div className="auth-mode" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>{t(locale, "login")}</button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => onModeChange("register")}>{t(locale, "register")}</button>
        </div>
        <form onSubmit={onSubmit}>
          <label>{t(locale, "handle")}<input aria-label={t(locale, "handle")} autoComplete="username" value={values.handle} onChange={(event) => onChange({ ...values, handle: event.target.value })} /></label>
          {mode === "register" ? <label>{t(locale, "displayName")}<input aria-label={t(locale, "displayName")} value={values.displayName} onChange={(event) => onChange({ ...values, displayName: event.target.value })} /></label> : null}
          <label>{t(locale, "password")}<input aria-label={t(locale, "password")} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={values.password} onChange={(event) => onChange({ ...values, password: event.target.value })} /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-command" disabled={busy} type="submit">{busy ? "..." : t(locale, "submit")}</button>
        </form>
      </section>
    </div>
  );
}
