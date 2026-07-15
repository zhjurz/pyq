/*
 * Vercel production installs omit devDependencies, so this intentionally uses
 * Node's built-in fs instead of patch-package. It removes parseurl@1.3.3's
 * deprecated url.parse() call after dependencies are installed.
 */
const fs = require("fs");
const path = require("path");

const parseurlPath = path.join(path.dirname(require.resolve("parseurl/package.json")), "index.js");
const source = fs.readFileSync(parseurlPath, "utf8");

if (source.includes("new URL(str, 'http://parseurl.invalid')")) {
  console.log("parseurl already uses the WHATWG URL API.");
  process.exit(0);
}

const legacy = "var url = require('url')\nvar parse = url.parse\nvar Url = url.Url";
const replacement = `var Url = require('url').Url

function parse (str) {
  var parsed = new URL(str, 'http://parseurl.invalid')
  var url = Url !== undefined ? new Url() : {}
  var isAbsolute = /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(str) || str.slice(0, 2) === '//'

  url.href = str
  url.pathname = parsed.pathname
  url.search = parsed.search || null
  url.query = parsed.search ? parsed.search.slice(1) : null
  url.hash = parsed.hash || null
  url.path = isAbsolute ? null : parsed.pathname + parsed.search

  return url
}`;

if (!source.includes(legacy)) {
  console.error("Unsupported parseurl source; did not apply URL compatibility patch.");
  process.exit(1);
}

fs.writeFileSync(parseurlPath, source.replace(legacy, replacement));
console.log("Patched parseurl to use the WHATWG URL API.");
