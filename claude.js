#!/usr/bin/env node

/**
 * HEIC Metadata Extraction Test
 * Tries 4 different methods and saves results to heic-metadata-results.json
 *
 * Usage: node heic-metadata-test.js /path/to/image.HEIC
 *
 * Install deps as needed:
 *   npm install exifr exiftool-vendored sharp
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── Prompt for file path if not passed as arg ────────────────────────────────

async function getFilePath() {
  if (process.argv[2]) return process.argv[2];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Enter path to HEIC image: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Method 1: exifr (full build) ─────────────────────────────────────────────

async function tryExifr(buffer) {
  try {
    const exifr = require("exifr/dist/full.umd.cjs");
    const data = await exifr.parse(buffer, {
      heic: true,
      tiff: true,
      icc: false,
      iptc: false,
      xmp: false,
      gps: true,
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Method 2: exiftool-vendored ──────────────────────────────────────────────

async function tryExiftoolVendored(filePath) {
  try {
    const { exiftool } = require("exiftool-vendored");
    const tags = await exiftool.read(filePath);
    await exiftool.end();
    return { success: true, data: tags };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Method 3: sharp ──────────────────────────────────────────────────────────

async function trySharp(filePath) {
  try {
    const sharp = require("sharp");
    const metadata = await sharp(filePath).metadata();
    // sharp exposes raw exif as a buffer — parse it with exifr if present
    let exifParsed = null;
    if (metadata.exif) {
      try {
        const exifr = require("exifr/dist/full.umd.cjs");
        exifParsed = await exifr.parse(metadata.exif, { gps: true, tiff: true });
      } catch (_) {
        exifParsed = `raw buffer (${metadata.exif.length} bytes, could not parse)`;
      }
    }
    return {
      success: true,
      data: {
        ...metadata,
        exif: exifParsed ?? metadata.exif ?? null,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const filePath = await getFilePath();
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`\nReading: ${absPath}`);
  const buffer = fs.readFileSync(absPath);
  console.log(`Buffer size: ${buffer.length} bytes\n`);

  const methods = [
    { name: "exifr (full build)", fn: () => tryExifr(buffer) },
    { name: "exiftool-vendored", fn: () => tryExiftoolVendored(absPath) },
    { name: "sharp",             fn: () => trySharp(absPath) },
  ];

  const results = {};

  for (const method of methods) {
    process.stdout.write(`Running ${method.name}... `);
    const result = await method.fn();
    results[method.name] = result;
    console.log(result.success ? "✓" : `✗  (${result.error})`);
  }

  const outFile = path.join(path.dirname(absPath), "heic-metadata-results.json");
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outFile}`);

  // Print a quick summary
  console.log("\n─── Summary ───────────────────────────────────────");
  for (const [name, result] of Object.entries(results)) {
    if (result.success && result.data) {
      const d = result.data;
      const date = d.DateTimeOriginal || d.CreateDate || d.DateTime || "—";
      const lat  = d.latitude  ?? d.GPSLatitude  ?? "—";
      const lng  = d.longitude ?? d.GPSLongitude ?? "—";
      const make = d.Make  || d.make  || "—";
      const model= d.Model || d.model || "—";
      console.log(`\n${name}:`);
      console.log(`  Date:   ${date}`);
      console.log(`  GPS:    ${lat}, ${lng}`);
      console.log(`  Camera: ${make} ${model}`);
    } else {
      console.log(`\n${name}: FAILED — ${result.error}`);
    }
  }
})();
