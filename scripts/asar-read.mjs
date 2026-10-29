// Minimal asar reader: list entries, or dump one file's text for inspection.
// asar layout: [uint32 4][uint32 headerPayloadSize][uint32 headerStringSize][uint32 jsonSize][header JSON][file data...]
import { openSync, readSync, readFileSync, closeSync } from "node:fs";

const ASAR = "C:\\Users\\fsx\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";

function readHeader() {
  const fd = openSync(ASAR, "r");
  const prefix = Buffer.alloc(16);
  readSync(fd, prefix, 0, 16, 0);
  const jsonSize = prefix.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonSize);
  readSync(fd, jsonBuf, 0, jsonSize, 16);
  closeSync(fd);
  return { header: JSON.parse(jsonBuf.toString("utf8")), dataOffset: 16 + jsonSize };
}

function walk(node, prefix, out) {
  if (!node || typeof node !== "object") return;
  if (node.files) {
    for (const name of Object.keys(node.files)) walk(node.files[name], prefix + "/" + name, out);
  } else if (typeof node.offset === "string" || typeof node.offset === "number") {
    out.push({ path: prefix, offset: Number(node.offset), size: Number(node.size || 0) });
  }
}

const { header, dataOffset } = readHeader();
const files = [];
walk(header, "", files);

const mode = process.argv[2] || "list";
const needle = process.argv[3] || "";

if (mode === "list") {
  const matched = files.filter((f) => f.path.includes(needle));
  console.log("total files:", files.length, "matched:", matched.length);
  for (const f of matched.slice(0, 60)) console.log(f.size.toString().padStart(8), f.path);
} else if (mode === "range") {
  const f = files.find((x) => x.path === needle) || files.find((x) => x.path.includes(needle));
  if (!f) {
    console.log("not found:", needle);
    process.exit(1);
  }
  const from = Number(process.argv[4] || 1);
  const to = Number(process.argv[5] || from + 40);
  const fd = openSync(ASAR, "r");
  const buf = Buffer.alloc(f.size);
  readSync(fd, buf, 0, f.size, dataOffset + f.offset);
  closeSync(fd);
  const lines = buf.toString("utf8").split(/\r?\n/);
  for (let i = from - 1; i < Math.min(to, lines.length); i += 1) {
    console.log(String(i + 1).padStart(6), lines[i].slice(0, 500));
  }
} else if (mode === "dump") {
  const f = files.find((x) => x.path === needle) || files.find((x) => x.path.includes(needle));
  if (!f) {
    console.log("not found:", needle);
    process.exit(1);
  }
  const fd = openSync(ASAR, "r");
  const buf = Buffer.alloc(f.size);
  readSync(fd, buf, 0, f.size, dataOffset + f.offset);
  closeSync(fd);
  const text = buf.toString("utf8");
  const grep = process.argv[4];
  if (!grep) {
    console.log(text.slice(0, 4000));
  } else {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes(grep)) console.log(String(index + 1).padStart(6), line.slice(0, 400));
    });
  }
}
