import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const version = "0.2.5";

const banner = `// ==UserScript==
// @name         Majsoul Helper MVP
// @namespace    https://local.majsoul-helper/
// @version      ${version}
// @description  Visible-state/debug helper for Mahjong Soul. No auto discard, no click automation, no message mutation.
// @match        *://*.mahjongsoul.com/*
// @match        *://mahjongsoul.game.yo-star.com/*
// @match        *://*.maj-soul.com/*
// @match        *://game.maj-soul.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
`;

const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  globalName: "MajsoulHelperBundle",
  platform: "browser",
  target: ["es2020"],
  write: false,
  legalComments: "none",
  logLevel: "silent"
});

await writeFile("majsoul-helper.user.js", `${banner}\n${result.outputFiles[0].text}`, "utf8");
