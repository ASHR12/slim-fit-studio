import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 3717);

const POWER_LINE_VALUES = {
  disabled: "0",
  "50hz": "1",
  "60hz": "2"
};

const POWER_LINE_BY_VALUE = {
  0: "disabled",
  1: "50hz",
  2: "60hz"
};

// Adjustable single-value controls exposed as sliders in the UI.
// `key` is the uvcc control name; metadata drives the front-end rendering.
const ADJUSTABLE_CONTROLS = [
  { key: "absolute_zoom", label: "Zoom", group: "lens", icon: "zoom" },
  { key: "brightness", label: "Brightness", group: "image", icon: "sun" },
  { key: "contrast", label: "Contrast", group: "image", icon: "contrast" },
  { key: "saturation", label: "Saturation", group: "image", icon: "drop" },
  { key: "sharpness", label: "Sharpness", group: "image", icon: "sharp" }
];

const ADJUSTABLE_KEYS = new Set(ADJUSTABLE_CONTROLS.map((control) => control.key));

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function localUvccPath() {
  const binaryName = process.platform === "win32" ? "uvcc.cmd" : "uvcc";
  const candidate = join(rootDir, "node_modules", ".bin", binaryName);
  return existsSync(candidate) ? candidate : "uvcc";
}

function localNode20Path() {
  const binaryName = process.platform === "win32" ? "node.exe" : "node";
  const candidate = join(rootDir, "node_modules", "node", "bin", binaryName);
  return existsSync(candidate) ? candidate : null;
}

async function runUvcc(args) {
  const node20 = localNode20Path();
  const command = node20 || localUvccPath();
  const commandArgs = node20 ? [localUvccPath(), ...args] : args;

  try {
    const { stdout, stderr } = await execFileAsync(command, commandArgs, {
      cwd: rootDir,
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });

    return {
      ok: true,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      args,
      command: [command, ...commandArgs].join(" ")
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || error.message,
      args,
      command: [command, ...commandArgs].join(" ")
    };
  }
}

function maybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }

  const text = String(value).trim();
  if (text.startsWith("0x")) {
    return text;
  }

  if (/^[0-9a-f]+$/i.test(text)) {
    return `0x${text}`;
  }

  return text;
}

function flattenDeviceCandidates(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenDeviceCandidates);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const nested = Object.values(value).flatMap((entry) =>
    typeof entry === "object" ? flattenDeviceCandidates(entry) : []
  );

  return [value, ...nested];
}

function findField(device, names) {
  const lowerNames = names.map((name) => name.toLowerCase());

  for (const [key, value] of Object.entries(device)) {
    const normalizedKey = key.replace(/[_\s-]/g, "").toLowerCase();
    if (lowerNames.some((name) => normalizedKey.includes(name))) {
      return value;
    }
  }

  return null;
}

function parseDevices(raw) {
  const parsed = maybeJson(raw);
  if (parsed) {
    return flattenDeviceCandidates(parsed)
      .map((device) => {
        const name = [
          findField(device, ["name"]),
          findField(device, ["manufacturer"]),
          findField(device, ["product"]),
          findField(device, ["model"])
        ]
          .filter(Boolean)
          .join(" ");

        return {
          name: name || JSON.stringify(device),
          vendorId: normalizeId(findField(device, ["vendorid", "vid", "vendor"])),
          productId: normalizeId(findField(device, ["productid", "pid", "product"])),
          raw: device
        };
      })
      .filter((device) => device.name || device.vendorId || device.productId);
  }

  const blocks = raw
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const vendorMatch = block.match(/(?:vendor|vid|vId)[^\da-f]*(0x[0-9a-f]+|\d+)/i);
    const productMatch = block.match(/(?:product|pid|pId)[^\da-f]*(0x[0-9a-f]+|\d+)/i);
    const nameMatch = block.match(/(?:name|model|product)[^\n:]*:\s*(.+)/i);

    return {
      name: nameMatch?.[1]?.trim() || block.split("\n")[0],
      vendorId: normalizeId(vendorMatch?.[1]),
      productId: normalizeId(productMatch?.[1]),
      raw: block
    };
  });
}

function findSamsungDevice(devices) {
  return devices.find((device) =>
    /samsung|slim\s*fit|slimfit/i.test(`${device.name} ${JSON.stringify(device.raw)}`)
  );
}

function targetArgs(device) {
  if (!device?.vendorId || !device?.productId) {
    return [];
  }

  return ["--vendor", device.vendorId, "--product", device.productId];
}

// Cache of the resolved device target + control ranges, so per-slider writes
// stay fast (a single `uvcc set`) instead of re-discovering the camera each time.
const deviceCache = {
  target: [],
  controls: [],
  samsung: null,
  at: 0
};

const CACHE_TTL_MS = 30_000;

async function ensureTarget() {
  if (deviceCache.target.length && Date.now() - deviceCache.at < CACHE_TTL_MS) {
    return deviceCache.target;
  }

  const deviceResult = await runUvcc(["devices"]);
  const devices = deviceResult.ok ? parseDevices(deviceResult.stdout) : [];
  const samsung = findSamsungDevice(devices);
  const target = targetArgs(samsung);

  deviceCache.target = target;
  deviceCache.samsung = samsung || null;
  deviceCache.at = Date.now();

  return target;
}

function asNumber(value) {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(number) ? number : null;
}

function buildControlList(rangesJson, exportJson) {
  return ADJUSTABLE_CONTROLS.map((control) => {
    const range = rangesJson?.[control.key];
    const current = asNumber(exportJson?.[control.key]);
    const min = asNumber(range?.min);
    const max = asNumber(range?.max);

    return {
      ...control,
      available: min !== null && max !== null,
      min,
      max,
      value: current
    };
  }).filter((control) => control.available);
}

async function cameraSnapshot() {
  const deviceResult = await runUvcc(["devices"]);
  const devices = deviceResult.ok ? parseDevices(deviceResult.stdout) : [];
  const samsung = findSamsungDevice(devices);
  const target = targetArgs(samsung);

  const controlsResult = await runUvcc([...target, "controls"]);
  const rangesResult = await runUvcc([...target, "ranges"]);
  const exportResult = await runUvcc([...target, "export"]);

  const rangesJson = maybeJson(rangesResult.stdout);
  const exportJson = maybeJson(exportResult.stdout);

  const powerValue = asNumber(exportJson?.power_line_frequency);
  const controls = buildControlList(rangesJson, exportJson);

  deviceCache.target = target;
  deviceCache.samsung = samsung || null;
  deviceCache.controls = controls;
  deviceCache.at = Date.now();

  return {
    uvccAvailable: deviceResult.ok,
    devices,
    samsung,
    target,
    supportsPowerLineFrequency: /power[_\s-]?line[_\s-]?frequency/i.test(
      `${controlsResult.stdout}\n${controlsResult.stderr}`
    ),
    powerLineFrequency: {
      value: powerValue,
      mode: powerValue === null ? null : POWER_LINE_BY_VALUE[powerValue] ?? null
    },
    controls,
    raw: {
      controls: controlsResult,
      ranges: rangesResult,
      export: exportResult
    }
  };
}

async function setPowerLineFrequency(mode) {
  const value = POWER_LINE_VALUES[mode];
  if (!value) {
    return {
      ok: false,
      error: `Unknown mode "${mode}". Use disabled, 50hz, or 60hz.`
    };
  }

  const target = await ensureTarget();
  const result = await runUvcc([...target, "set", "power_line_frequency", value]);

  return {
    kind: "anti-flicker",
    mode,
    value,
    camera: deviceCache.samsung || null,
    result
  };
}

async function setControl(controlName, rawValue) {
  if (!ADJUSTABLE_KEYS.has(controlName)) {
    return { ok: false, error: `Control "${controlName}" is not adjustable.` };
  }

  let value = Math.round(Number(rawValue));
  if (!Number.isFinite(value)) {
    return { ok: false, error: `Invalid value "${rawValue}".` };
  }

  // Fast path: use cached target + range so a slider write is a single subprocess.
  const target = await ensureTarget();
  const meta = deviceCache.controls.find((control) => control.key === controlName);

  if (meta && Number.isFinite(meta.min) && Number.isFinite(meta.max)) {
    value = Math.min(meta.max, Math.max(meta.min, value));
  }

  const result = await runUvcc([...target, "set", controlName, String(value)]);

  return {
    kind: "control",
    control: controlName,
    value,
    result
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": contentTypes[".json"] });
  response.end(JSON.stringify(body, null, 2));
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = resolve(publicDir, `.${pathname}`);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleApi(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/status") {
    sendJson(response, 200, await cameraSnapshot());
    return;
  }

  if (requestUrl.pathname === "/api/set") {
    const mode = requestUrl.searchParams.get("mode");
    const control = requestUrl.searchParams.get("control");

    if (control) {
      const value = requestUrl.searchParams.get("value");
      const result = await setControl(control, value);
      sendJson(response, result.result?.ok ? 200 : 500, result);
      return;
    }

    const result = await setPowerLineFrequency(mode || "");
    sendJson(response, result.result?.ok ? 200 : 500, result);
    return;
  }

  sendJson(response, 404, { error: "Unknown API route" });
}

async function requestHandler(request, response) {
  try {
    if (request.url?.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

if (process.argv.includes("--doctor")) {
  const snapshot = await cameraSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  createServer(requestHandler).listen(port, () => {
    console.log(`Samsung Slim Fit Camera control app: http://localhost:${port}`);
  });
}
