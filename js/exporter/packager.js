export function normalizeAureaManifest(rawManifest, fallbackProject = {}) {
  const root = rawManifest && typeof rawManifest === 'object' ? rawManifest : {};
  const meta = root.AureaPlugin && typeof root.AureaPlugin === 'object' ? root.AureaPlugin : root;

  const detectedVersion = Number(
    meta.formatVersion ??
    meta.version ??
    meta.apiVersion ??
    root.formatVersion ??
    root.version ??
    1
  ) || 1;

  const name = String(
    meta.name ??
    meta.title ??
    meta.pluginName ??
    root.name ??
    fallbackProject.name ??
    ''
  ).trim();

  const author = String(
    meta.author ??
    meta.creator ??
    root.author ??
    fallbackProject.author ??
    'NikoAjj'
  ).trim();

  const id = String(
    meta.id ??
    meta.package ??
    root.id ??
    fallbackProject.id ??
    `com.${author.toLowerCase().replace(/[^a-z0-9]/g, '') || 'creator'}.${name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'plugin'}`
  ).trim();

  const entry = String(
    meta.entry ??
    meta.shader ??
    meta.main ??
    root.entry ??
    'shader.frag'
  ).trim();

  const rawParams = Array.isArray(meta.params)
    ? meta.params
    : Array.isArray(meta.parameters)
      ? meta.parameters
      : Array.isArray(root.params)
        ? root.params
        : [];

  const params = rawParams.map((p, idx) => ({
    ...p,
    id: String(p.id || p.name || `param_${idx}`),
    label: String(p.label || p.title || p.name || p.id || `Param ${idx + 1}`),
    type: String(p.type || 'float').toLowerCase()
  }));

  return {
    ...meta,
    formatVersion: detectedVersion,
    id,
    name,
    author,
    entry,
    params,
    _isWrappedAureaPlugin: Boolean(root.AureaPlugin)
  };
}

export function validatePluginProject(project) {
  const errors = [];
  if (!project || !project.files) {
    return { valid: false, errors: ['Invalid project structure.'], manifest: null };
  }

  const rawJson = project.files['plugin.json'];
  if (!rawJson) {
    return { valid: false, errors: ['Missing plugin.json file.'], manifest: null };
  }

  let parsedRaw;
  try {
    parsedRaw = JSON.parse(rawJson);
  } catch (err) {
    return { valid: false, errors: [`Invalid JSON syntax in plugin.json: ${err.message}`], manifest: null };
  }

  const manifest = normalizeAureaManifest(parsedRaw, project);

  if (!manifest.name) {
    errors.push("Plugin 'name' is required in plugin.json.");
  }

  const entryFile = manifest.entry || 'shader.frag';
  if (!project.files[entryFile]) {
    errors.push(`Entry shader file '${entryFile}' not found in project.`);
  }

  manifest.params.forEach((p, i) => {
    if (!p.id) errors.push(`Parameter #${i + 1} is missing an 'id' or 'name'.`);
  });

  return {
    valid: errors.length === 0,
    errors,
    manifest
  };
}


function makeCrcTable() {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }

  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function joinBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2);

  const dosDate =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  for (const [filename, content] of Object.entries(files)) {
    const name = encoder.encode(filename);
    const data = typeof content === "string"
      ? encoder.encode(content)
      : content;

    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);

    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);

    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    centralParts.push(central);
    offset += local.length + data.length;
  }

  const centralDirectory = joinBytes(centralParts);
  const localData = joinBytes(localParts);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);

  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, centralParts.length, true);
  ev.setUint16(10, centralParts.length, true);
  ev.setUint32(12, centralDirectory.length, true);
  ev.setUint32(16, localData.length, true);
  ev.setUint16(20, 0, true);

  return joinBytes([localData, centralDirectory, end]);
}

export function exportAureaPlugin(project) {
  const check = validatePluginProject(project);

  if (!check.valid) {
    return { ok: false, errors: check.errors };
  }
console.log("PROJECT:", project);
console.log("FILES:", project.files);
  const zipBytes = createZip(project.files);

  const blob = new Blob([zipBytes], {
    type: "application/zip"
  });

  const filename =
    `${check.manifest.name.replace(/\s+/g, "_")}_V${check.manifest.formatVersion}.aureaplugin`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    ok: true,
    filename,
    manifest: check.manifest
  };
}
