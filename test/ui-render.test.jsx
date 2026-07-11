// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthModal } from "../src/components/AuthModal.jsx";
import { AppShell } from "../src/components/AppShell.jsx";
import {
  loadLocalProviderConfig,
  providerMetadataPayload,
  saveLocalProviderConfig
} from "../src/lib/local-config.js";
import { Sim } from "../src/lib/sim.js";

afterEach(() => cleanup());

describe("simulation module", () => {
  it("exports the browser simulation engine without relying on script order", () => {
    expect(typeof Sim.createInitialState).toBe("function");
    expect(Sim.createInitialState({ seed: 1 }).units).toHaveLength(4);
  });
});

describe("browser-local provider configuration", () => {
  it("keeps the API key local while producing key-free profile metadata", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    };
    const config = {
      provider: "openai",
      model: "gpt-5.5",
      apiKey: "sk-browser-only",
      standingOrder: "use precise functions",
      autoRounds: 1
    };
    saveLocalProviderConfig(storage, config);
    expect(loadLocalProviderConfig(storage)).toEqual(config);
    expect(providerMetadataPayload(config)).toEqual({
      providers: { openai: { model: "gpt-5.5" } }
    });
    expect(JSON.stringify(providerMetadataPayload(config))).not.toContain("sk-browser-only");
  });
});

describe("application shell", () => {
  it("sets the document language and exposes only the three product destinations", () => {
    render(
      <AppShell locale="zh" activePage="play" onNavigate={() => {}} onToggleLocale={() => {}} profile={null} onOpenAuth={() => {}}>
        <main>content</main>
      </AppShell>
    );
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByRole("navigation").querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "开始游戏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "排行榜" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "API 文档" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });
});

describe("authentication modal", () => {
  it("moves focus inside, closes on Escape, and restores the opener", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.appendChild(opener);
    opener.focus();
    render(
      <AuthModal
        open
        locale="en"
        mode="login"
        values={{ handle: "", displayName: "", password: "" }}
        busy={false}
        error=""
        onModeChange={() => {}}
        onChange={() => {}}
        onSubmit={() => {}}
        onClose={onClose}
      />
    );
    expect(screen.getByLabelText("Handle")).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    expect(opener).toBe(document.activeElement);
    opener.remove();
  });
});
