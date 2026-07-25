'use strict';

// Hard-coded realm names (English, lowercase) — used before/if the photo
// directory cannot be scanned. Add new DLC realms here as they ship.
// Realms only: a map name in here gets classified as a realm by OcrMatcher,
// which silently makes that map undetectable.
const FALLBACK_REALMS = new Set([
    'autohaven wreckers',
    'backwater swamp',
    'coldwind farm',
    'crotus prenn asylum',
    'dvarka deepwood',
    'forsaken boneyard',
    'gideon meat plant',
    'grave of glenvale',
    'haddonfield',
    'hawkins national laboratory',
    "léry's memorial institute",
    "lery's memorial institute",
    'ormond',
    'raccoon city',
    'red forest',
    'silent hill',
    'springwood',
    'the decimated borgo',
    'the macmillan estate',
    'withered isle',
    'yamaoka estate',
]);

module.exports = { FALLBACK_REALMS };
