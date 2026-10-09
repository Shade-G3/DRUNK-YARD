/**
 * Compatibility entry point.
 * v1 deployments started the app with `node Server/server.js`. v2 is TypeScript and
 * runs from Server/dist/index.js after `npm run build`. This file keeps the old start
 * command working — and explains clearly what's wrong if the build never ran.
 */
const fs = require("fs");
const path = require("path");

const entry = path.join(__dirname, "dist", "index.js");
if (!fs.existsSync(entry)) {
  console.error(
    [
      "",
      "✖ Drunk Yard server is not built (missing Server/dist/index.js).",
      "  Set your host's commands to:",
      "    Build command:  npm run build",
      "    Start command:  npm start",
      "  (run from the repository root, not from Server/)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
require(entry);
