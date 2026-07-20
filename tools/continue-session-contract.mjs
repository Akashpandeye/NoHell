import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const routePath = "src/app/api/sessions/route.ts";
const serverPath = "src/lib/server-firestore.ts";

assert.ok(existsSync(routePath), "authenticated sessions route is missing");

const route = readFileSync(routePath, "utf8");
const server = readFileSync(serverPath, "utf8");

assert.match(route, /requireUserId/);
assert.match(route, /serverGetSessionsForUser/);
assert.match(server, /\.in\("status", \["active", "paused"\]\)/);

console.log("continue-session route contract: PASS");
