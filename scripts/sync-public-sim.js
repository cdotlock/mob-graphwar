"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(root, "src", "sim-core.js");
const targetDir = path.join(root, "public", "src");
const target = path.join(targetDir, "sim-core.js");

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Synced ${path.relative(root, source)} -> ${path.relative(root, target)}`);
