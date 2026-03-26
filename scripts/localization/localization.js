#!/usr/bin/env node
/**
 * Localization table generator for DBD maps.
 *
 * Reads all map PNG files from maps/creator/realm/name.png, finds the
 * localization key in the English game strings, then writes one i18n JSON
 * file per language into the output folder.
 *
 * Each file has the format: { "English Name": "Localized Name", ... }
 *
 * Output: scripts/localization/i18n/[lang].json
 * Usage:  node scripts/localization/localization.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '../..');
const MAPS_DIR   = path.join(ROOT, 'maps');
const LANGS_DIR  = path.join(__dirname, 'langs');
const OUTPUT_DIR = path.join(__dirname, 'i18n');

// ---------------------------------------------------------------------------
// Explicit aliases: filesystem display name (after normalization) → game name
// Used when the creator's naming differs too much from the actual game string.
// ---------------------------------------------------------------------------
const ALIASES = {
  // Raccoon City maps use floor/wing in the game name
  'raccoon city east': 'Raccoon City Police Station East Wing',
  'raccoon city west': 'Raccoon City Police Station West Wing',

  // Silent Hill map is called "Midwich Elementary School" in-game;
  // the creator used "Midwich 1/2/3 (Floor)" as display names.
  'midwich': 'Midwich Elementary School',

  // Badham maps use Roman numerals; creator used Arabic numerals + typo.
  'badham preeschool 1': 'Badham Preschool I',
  'badham preeschool 2': 'Badham Preschool II',
  'badham preeschool 3': 'Badham Preschool III',
  'badham preeschool 4': 'Badham Preschool IV',
  'badham preeschool 5': 'Badham Preschool V',
};

// ---------------------------------------------------------------------------
// String normalisation helpers
// ---------------------------------------------------------------------------

/** Remove diacritics (é → e, etc.) using Unicode NFD decomposition. */
function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Canonical form used for all comparisons:
 *   - strip diacritics
 *   - remove apostrophes / curly apostrophes and the possessive 's that follows
 *   - lowercase
 */
function canonical(s) {
  return stripAccents(s)
    .replace(/[\u2018\u2019'`]s?\b/g, '')  // remove 's or lone apostrophe
    .replace(/'/g, '')                      // straight apostrophe fallback
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a filesystem display name for searching.
 * Removes:
 *   - trailing parenthetical suffixes  e.g. " (Lower Floor)" " (Both Floors)"
 *   - trailing Arabic numerals         e.g. "Coal Tower 1" → "Coal Tower"
 * Applied twice so "The Game 2 (Lower Floor)" → "The Game".
 */
function normalize(name) {
  let s = name.trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();  // strip parenthetical
  s = s.replace(/\s+\d+$/, '').trim();            // strip trailing number
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();  // second pass
  s = s.replace(/\s+\d+$/, '').trim();
  return s;
}

// ---------------------------------------------------------------------------
// Language loading
// ---------------------------------------------------------------------------

/** Load every lang/*.json file; returns { langCode: { KEY: value } } */
function loadLangs() {
  const langs = {};
  for (const file of fs.readdirSync(LANGS_DIR).filter(f => f.endsWith('.json'))) {
    const code = path.basename(file, '.json');
    const raw  = JSON.parse(fs.readFileSync(path.join(LANGS_DIR, file), 'utf8'));
    langs[code] = raw[''] || {};
  }
  return langs;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/**
 * Build a canonical inverted index from the English data.
 * Returns Map<canonicalValue, { key, originalValue }>
 * When multiple keys share the same English text, keeps the first one found.
 */
function buildIndex(enData) {
  const index = new Map();
  for (const [key, value] of Object.entries(enData)) {
    const c = canonical(value.trim());
    if (c.length > 1 && !index.has(c)) {
      index.set(c, { key, originalValue: value.trim() });
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Key lookup
// ---------------------------------------------------------------------------

/**
 * Look up a display name in the index using several strategies (all
 * case-insensitive and accent/apostrophe-insensitive):
 *   1. Check ALIASES map on the normalized form
 *   2. Exact canonical match on original display name
 *   3. Exact canonical match on normalized display name
 * Returns { key, enValue } or null.
 */
function findKey(displayName, index) {
  const normDisplay = normalize(displayName);

  // 1. Explicit alias
  const aliasTarget = ALIASES[canonical(displayName)] || ALIASES[canonical(normDisplay)];
  if (aliasTarget) {
    const hit = index.get(canonical(aliasTarget));
    if (hit) return hit;
  }

  // 2 & 3. Canonical match on original / normalized
  for (const candidate of [displayName, normDisplay]) {
    const hit = index.get(canonical(candidate));
    if (hit) return hit;
  }

  return null;
}

/**
 * Case-insensitive substring suggestions (minimum 4 chars) for "not found".
 * Returns up to `limit` English values whose canonical form contains the needle.
 */
function suggest(searchStr, index, limit = 5) {
  const needle = canonical(searchStr);
  if (needle.length < 4) return [];

  const results = [];
  for (const [c, { originalValue }] of index) {
    if (c.includes(needle) || needle.includes(c)) {
      results.push(originalValue);
      if (results.length >= limit) break;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Per-language map building
// ---------------------------------------------------------------------------

/**
 * Add an entry to every language bucket.
 * @param {string}  enValue  - English display string (used as key in every file)
 * @param {string}  gameKey  - Internal game localization key
 * @param {object}  langs    - { langCode: { KEY: value } }
 * @param {object}  buckets  - { langCode: { enValue: translation } }  (mutated)
 */
function addEntry(enValue, gameKey, langs, buckets) {
  for (const [lang, data] of Object.entries(langs)) {
    if (data[gameKey] !== undefined) {
      buckets[lang][enValue] = data[gameKey].trim();
    }
  }
}

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

function scanMaps() {
  const entries = [];

  if (!fs.existsSync(MAPS_DIR)) {
    console.error(`Maps directory not found: ${MAPS_DIR}`);
    return entries;
  }

  for (const creator of fs.readdirSync(MAPS_DIR)) {
    const creatorDir = path.join(MAPS_DIR, creator);
    if (!fs.statSync(creatorDir).isDirectory()) continue;

    for (const realm of fs.readdirSync(creatorDir)) {
      const realmDir = path.join(creatorDir, realm);
      if (!fs.statSync(realmDir).isDirectory()) continue;

      for (const file of fs.readdirSync(realmDir)) {
        if (!file.endsWith('.png')) continue;
        entries.push({ creator, realm, mapName: path.basename(file, '.png') });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Loading language files...');
  const langs  = loadLangs();
  const enData = langs['en'];

  if (!enData) {
    console.error('English localization (en.json) not found in langs/');
    process.exit(1);
  }

  const langCodes = Object.keys(langs).sort();
  console.log(`Languages: ${langCodes.join(', ')}`);
  console.log(`English entries: ${Object.keys(enData).length}\n`);

  const index = buildIndex(enData);

  console.log('Scanning map files...');
  const mapEntries = scanMaps();
  console.log(`Found ${mapEntries.length} map files\n`);

  // Collect unique realms and map display names (preserving insertion order)
  const uniqueRealms   = new Map();
  const uniqueMapNames = new Map();

  for (const { realm, mapName } of mapEntries) {
    if (!uniqueRealms.has(realm))     uniqueRealms.set(realm, realm);
    if (!uniqueMapNames.has(mapName)) uniqueMapNames.set(mapName, mapName);
  }

  // One bucket per language: { langCode: { "English Name": "Translation" } }
  const buckets = {};
  for (const lang of Object.keys(langs)) buckets[lang] = {};

  const notFound = { realms: [], maps: [] };

  // --- Realms ---
  console.log('=== Realms ===');
  for (const displayName of uniqueRealms.keys()) {
    const hit = findKey(displayName, index);
    if (hit) {
      addEntry(hit.originalValue, hit.key, langs, buckets);
      console.log(`  [FOUND]     "${displayName}"  →  "${hit.originalValue}"  (${hit.key})`);
    } else {
      notFound.realms.push(displayName);
      console.log(`  [NOT FOUND] "${displayName}"`);
    }
  }

  // --- Map names ---
  console.log('\n=== Map Names ===');
  for (const displayName of uniqueMapNames.keys()) {
    const hit = findKey(displayName, index);
    if (hit) {
      addEntry(hit.originalValue, hit.key, langs, buckets);
      console.log(`  [FOUND]     "${displayName}"  →  "${hit.originalValue}"  (${hit.key})`);
    } else {
      notFound.maps.push(displayName);
      console.log(`  [NOT FOUND] "${displayName}"`);
    }
  }

  // --- Write one file per language ---
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [lang, entries] of Object.entries(buckets)) {
    const file = path.join(OUTPUT_DIR, `${lang}.json`);
    fs.writeFileSync(file, JSON.stringify(entries, null, 2), 'utf8');
  }
  console.log(`\nLocalization files written to: ${OUTPUT_DIR}/`);
  console.log(`  Languages: ${Object.keys(buckets).sort().join(', ')}`);

  const uniqueKeys = new Set(Object.values(buckets).flatMap(b => Object.keys(b)));
  console.log(`  Realms resolved: ${[...uniqueRealms.keys()].filter(n => !notFound.realms.includes(n)).length} / ${uniqueRealms.size}`);
  console.log(`  Maps resolved:   ${[...uniqueMapNames.keys()].filter(n => !notFound.maps.includes(n)).length} / ${uniqueMapNames.size}`);
  console.log(`  Total unique entries per language file: ${uniqueKeys.size}`);

  // --- Not-found report with suggestions ---
  if (notFound.realms.length === 0 && notFound.maps.length === 0) {
    console.log('\nAll realms and map names were resolved successfully.');
    return;
  }

  console.log('\n========================================');
  console.log('NOT FOUND — with case-insensitive suggestions');
  console.log('========================================');

  if (notFound.realms.length > 0) {
    console.log('\n-- Realms --');
    for (const name of notFound.realms) {
      const norm = normalize(name);
      console.log(`\n  "${name}"  (searched also as: "${norm}")`);
      const hints = suggest(norm || name, index);
      if (hints.length > 0) {
        console.log('  Possible matches:');
        hints.forEach(h => console.log(`    * "${h}"`));
      } else {
        console.log('  No similar entries found in English localization.');
      }
    }
  }

  if (notFound.maps.length > 0) {
    console.log('\n-- Map Names --');
    for (const name of notFound.maps) {
      const norm = normalize(name);
      console.log(`\n  "${name}"  (searched also as: "${norm}")`);
      const hints = suggest(norm || name, index);
      if (hints.length > 0) {
        console.log('  Possible matches:');
        hints.forEach(h => console.log(`    * "${h}"`));
      } else {
        console.log('  No similar entries found in English localization.');
      }
    }
  }
}

main();
