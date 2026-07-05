"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { listProviders, getProvider } = require("./providers/catalog.js");
const { executeProviderDecision } = require("./providers/execute.js");
const Contract = require("../src/agents/contract.js");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(ROOT, `.${decodeURIComponent(rawPath)}`);
  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const type = MIME[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(data);
  });
}

function summarizeState(state) {
  return {
    seed: state.seed,
    turn: state.turn,
    map: state.mapMeta,
    units: (state.units || []).map((unit) => ({
      id: unit.id,
      team: unit.team,
      x: unit.x,
      y: unit.y,
      hp: unit.hp
    })),
    obstacles: (state.obstacles || []).map((obstacle) => ({
      id: obstacle.id,
      x: obstacle.x,
      y: obstacle.y,
      w: obstacle.w,
      h: obstacle.h
    }))
  };
}

function providerErrorStatus(error) {
  if (error.message === "missing_api_key") return 400;
  if (error.message === "unknown_candidate") return 422;
  if (error.message === "missing_candidate_id") return 502;
  if (error.message === "invalid_provider_json") return 502;
  if (error.message === "provider_http_error") return 502;
  return 400;
}

function createServer(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fetchFn = opts.fetch || globalThis.fetch;
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/providers") {
        sendJson(res, 200, { providers: listProviders(env) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/agent/shot") {
        const body = JSON.parse(await readBody(req, 512_000));
        const provider = getProvider(body.provider);
        const allowedProviders = listProviders(env).map((item) => item.id);
        if (!provider || !allowedProviders.includes(provider.id)) {
          sendJson(res, 400, { error: "unknown_provider" });
          return;
        }
        if (!body.state || (body.team !== "A" && body.team !== "B")) {
          sendJson(res, 400, { error: "invalid_agent_request" });
          return;
        }
        const command = String(body.command || "").slice(0, 80);
        const candidates = Contract.listPublicShotCandidates(body.state, body.team, command);
        if (!candidates.length) {
          sendJson(res, 409, { error: "no_legal_candidates" });
          return;
        }
        try {
          const result = await executeProviderDecision(
            provider,
            {
              apiKey: body.apiKey,
              command,
              candidates,
              stateSummary: summarizeState(body.state),
              model: body.model
            },
            { env, fetch: fetchFn }
          );
          sendJson(res, 200, {
            provider: provider.id,
            model: body.model || env[provider.modelEnv] || provider.defaultModel,
            decision: result.decision,
            candidate: result.candidate,
            candidatesConsidered: candidates.length
          });
        } catch (err) {
          sendJson(res, providerErrorStatus(err), { error: err.message || "provider_error" });
        }
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        serveStatic(req, res);
        return;
      }
      sendJson(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      sendJson(res, err.message === "body_too_large" ? 413 : 400, { error: err.message || "bad_request" });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`Mob Graphwar listening on http://${host}:${port}`);
  });
}

module.exports = {
  createServer
};
