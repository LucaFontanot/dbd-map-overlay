const {test} = require('node:test');
const assert = require('node:assert/strict');
const {logicalMapKeyFromPath, findClosestMapMatch, parseMapPath} = require('../src/core/map-match');

const lookup = {
    'SamoelColt/The Macmillan Estate/Coal Tower.png': '/SamoelColt/The Macmillan Estate/Coal Tower.png',
    'EagerFace/The Macmillan Estate/Coal Tower.png': '/EagerFace/The Macmillan Estate/Coal Tower.png',
    'SamoelColt/The Macmillan Estate/Shelter Woods.png': '/SamoelColt/The Macmillan Estate/Shelter Woods.png',
    'Hens333/Autohaven Wreckers/Blood Lodge.png': '/Hens333/Autohaven Wreckers/Blood Lodge.png',
};

test('logicalMapKeyFromPath strips creator and extension', () => {
    assert.equal(
        logicalMapKeyFromPath('/SamoelColt/The Macmillan Estate/Coal Tower.png'),
        'The Macmillan Estate/Coal Tower'
    );
    assert.equal(
        logicalMapKeyFromPath('\\EagerFace\\The Macmillan Estate\\Coal Tower.png'),
        'The Macmillan Estate/Coal Tower'
    );
});

test('logicalMapKeyFromPath returns null for short custom paths', () => {
    assert.equal(logicalMapKeyFromPath('/mymap.png'), null);
    assert.equal(logicalMapKeyFromPath(''), null);
});

test('findClosestMapMatch prefers the selected creator for an OCR realm/map key', () => {
    assert.equal(
        findClosestMapMatch('The Macmillan Estate/Coal Tower', lookup, 'EagerFace'),
        '/EagerFace/The Macmillan Estate/Coal Tower.png'
    );
});

test('findClosestMapMatch falls back to any creator when preferred has no copy', () => {
    assert.equal(
        findClosestMapMatch('Autohaven Wreckers/Blood Lodge', lookup, 'EagerFace'),
        '/Hens333/Autohaven Wreckers/Blood Lodge.png'
    );
});

test('findClosestMapMatch with fallback:false never leaves the chosen creator', () => {
    assert.equal(
        findClosestMapMatch('Autohaven Wreckers/Blood Lodge', lookup, 'EagerFace', {fallback: false}),
        null
    );
});

test('switching creator for the same logical map returns that creator\'s file', () => {
    const identity = logicalMapKeyFromPath(lookup['SamoelColt/The Macmillan Estate/Coal Tower.png']);
    assert.equal(
        findClosestMapMatch(identity, lookup, 'EagerFace', {fallback: false}),
        '/EagerFace/The Macmillan Estate/Coal Tower.png'
    );
});

const stanleyLookup = {
    ...lookup,
    'StanleyWav/Macmillan Estate I/Coal Tower 1 - Istari.jpg': '/StanleyWav/Macmillan Estate I/Coal Tower 1 - Istari.jpg',
    'StanleyWav/Autohaven Wreckers/Blood Lodge - Istari.jpg': '/StanleyWav/Autohaven Wreckers/Blood Lodge - Istari.jpg',
};

test('StanleyWav suffixed filenames still match the detected map name', () => {
    assert.equal(
        findClosestMapMatch('The Macmillan Estate/Coal Tower', stanleyLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Macmillan Estate I/Coal Tower 1 - Istari.jpg'
    );
    assert.equal(
        findClosestMapMatch('Autohaven Wreckers/Blood Lodge', stanleyLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Autohaven Wreckers/Blood Lodge - Istari.jpg'
    );
});

test('switching away from a StanleyWav file still finds the standard filename', () => {
    const identity = logicalMapKeyFromPath(stanleyLookup['StanleyWav/Macmillan Estate I/Coal Tower 1 - Istari.jpg']);
    assert.equal(
        findClosestMapMatch(identity, stanleyLookup, 'EagerFace', {fallback: false}),
        '/EagerFace/The Macmillan Estate/Coal Tower.png'
    );
});

const mixedLookup = {
    ...stanleyLookup,
    "DbDLeague/The MacMillan Estate/Coal Tower.png": "/DbDLeague/The MacMillan Estate/Coal Tower.png",
    "DbDLeague/The MacMillan Estate/Ironworks Of Misery.png": "/DbDLeague/The MacMillan Estate/Ironworks Of Misery.png",
    "DbDLeague/Autohaven Wreckers/Wreckers' Yard.png": "/DbDLeague/Autohaven Wreckers/Wreckers' Yard.png",
    "StanleyWav/Autohaven Wreckers/Wreckers Yard - Istari.jpg": "/StanleyWav/Autohaven Wreckers/Wreckers Yard - Istari.jpg",
    "Hens333/Autohaven Wreckers/Azarov’s Resting Place.webp": "/Hens333/Autohaven Wreckers/Azarov’s Resting Place.webp",
    "SamoelColt/Autohaven Wreckers/Azarov's Resting Place.png": "/SamoelColt/Autohaven Wreckers/Azarov's Resting Place.png",
    "KaiserAleex/Lery's Memorial Institute/Treatment Theatre.png": "/KaiserAleex/Lery's Memorial Institute/Treatment Theatre.png",
    "SamoelColt/Léry's Memorial Institute/Treatment Theatre.png": "/SamoelColt/Léry's Memorial Institute/Treatment Theatre.png",
};

test('closest name ignores apostrophes, accents, and Of/of', () => {
    assert.equal(
        findClosestMapMatch("Autohaven Wreckers/Wreckers' Yard", mixedLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Autohaven Wreckers/Wreckers Yard - Istari.jpg'
    );
    assert.equal(
        findClosestMapMatch("Autohaven Wreckers/Azarov's Resting Place", mixedLookup, 'Hens333', {fallback: false}),
        "/Hens333/Autohaven Wreckers/Azarov’s Resting Place.webp"
    );
    assert.equal(
        findClosestMapMatch('The Macmillan Estate/Ironworks of Misery', mixedLookup, 'DbDLeague', {fallback: false}),
        '/DbDLeague/The MacMillan Estate/Ironworks Of Misery.png'
    );
    assert.equal(
        findClosestMapMatch("Léry's Memorial Institute/Treatment Theatre", mixedLookup, 'KaiserAleex', {fallback: false}),
        "/KaiserAleex/Lery's Memorial Institute/Treatment Theatre.png"
    );
});

test('closest name does not pick a different map in the same realm', () => {
    assert.equal(
        findClosestMapMatch('Autohaven Wreckers/Blood Lodge', mixedLookup, 'DbDLeague', {fallback: false}),
        null
    );
});

const catalogLookup = {
    ...mixedLookup,
    'StanleyWav/Backwater Swamp/Pale Rose - Istari.jpg': '/StanleyWav/Backwater Swamp/Pale Rose - Istari.jpg',
    'StanleyWav/Grave of Glenvale/Dead Dawg Saloon EU - Istari.jpg': '/StanleyWav/Grave of Glenvale/Dead Dawg Saloon EU - Istari.jpg',
    'StanleyWav/Hawkins National Laboratory/Underground Complex - Istari.jpg': '/StanleyWav/Hawkins National Laboratory/Underground Complex - Istari.jpg',
    'StanleyWav/The Decimated Borgo/Shattered Square - Istari.jpg': '/StanleyWav/The Decimated Borgo/Shattered Square - Istari.jpg',
    'StanleyWav/Gideon Meat Plant/Gideon Meat Plant.gif': '/StanleyWav/Gideon Meat Plant/Gideon Meat Plant.gif',
    'SamoelColt/Disturbed Ward/Crotus Prenn Asylum.jpg': '/SamoelColt/Disturbed Ward/Crotus Prenn Asylum.jpg',
    "SamoelColt/Disturbed Ward/Father Cambell's Chapel.jpg": "/SamoelColt/Disturbed Ward/Father Cambell's Chapel.jpg",
    'SamoelColt/Gideon Meat Plant/The Game.jpg': '/SamoelColt/Gideon Meat Plant/The Game.jpg',
    'SamoelColt/Gideon Meat Plant/The Game (2).jpg': '/SamoelColt/Gideon Meat Plant/The Game (2).jpg',
    'SamoelColt/Ormond/Lake Mine.jpg': '/SamoelColt/Ormond/Lake Mine.jpg',
    'SamoelColt/Raccoon City/Raccoon City Police Station (Lower Floor).jpg': '/SamoelColt/Raccoon City/Raccoon City Police Station (Lower Floor).jpg',
    'Hens333/Coldwind Farm/Rancid Abbatoir.webp': '/Hens333/Coldwind Farm/Rancid Abbatoir.webp',
    'KaiserAleex/Springwood/Badham Preeschool.png': '/KaiserAleex/Springwood/Badham Preeschool.png',
    'KaiserAleex/Red Forest/The Temple of Purgation.png': '/KaiserAleex/Red Forest/The Temple of Purgation.png',
    'EagerFace/Red Forest/Temple Of Purgation.jpg': '/EagerFace/Red Forest/Temple Of Purgation.jpg',
    'EagerFace/Hawkins National Laboratory/The Undrground Complex.jpg': '/EagerFace/Hawkins National Laboratory/The Undrground Complex.jpg',
    'Hens333/Raccoon City/Raccoon City Police Station East Wing.webp': '/Hens333/Raccoon City/Raccoon City Police Station East Wing.webp',
    'Hens333/Raccoon City/Raccoon City Police Station West Wing.webp': '/Hens333/Raccoon City/Raccoon City Police Station West Wing.webp',
    'KaiserAleex/Raccoon City/Raccoon City East (Lower Floor).png': '/KaiserAleex/Raccoon City/Raccoon City East (Lower Floor).png',
};

test('closest name drops leading The, region tags, and parenthetical floors', () => {
    assert.equal(
        findClosestMapMatch('Backwater Swamp/The Pale Rose', catalogLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Backwater Swamp/Pale Rose - Istari.jpg'
    );
    assert.equal(
        findClosestMapMatch('Grave of Glenvale/Dead Dawg Saloon', catalogLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Grave of Glenvale/Dead Dawg Saloon EU - Istari.jpg'
    );
    assert.equal(
        findClosestMapMatch('Hawkins National Laboratory/The Underground Complex', catalogLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Hawkins National Laboratory/Underground Complex - Istari.jpg'
    );
    assert.equal(
        findClosestMapMatch('The Decimated Borgo/The Shattered Square', catalogLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/The Decimated Borgo/Shattered Square - Istari.jpg'
    );
});

test('closest name prefers the unsuffixed file over a floor variant', () => {
    assert.equal(
        findClosestMapMatch('Gideon Meat Plant/The Game', catalogLookup, 'SamoelColt', {fallback: false}),
        '/SamoelColt/Gideon Meat Plant/The Game.jpg'
    );
});

test('closest name matches typos, missing words, and swapped realm folders', () => {
    assert.equal(
        findClosestMapMatch('Coldwind Farm/Rancid Abattoir', catalogLookup, 'Hens333', {fallback: false}),
        '/Hens333/Coldwind Farm/Rancid Abbatoir.webp'
    );
    assert.equal(
        findClosestMapMatch("Crotus Prenn Asylum/Father Campbell's Chapel", catalogLookup, 'SamoelColt', {fallback: false}),
        "/SamoelColt/Disturbed Ward/Father Cambell's Chapel.jpg"
    );
    assert.equal(
        findClosestMapMatch('Springwood/Badham Preschool', catalogLookup, 'KaiserAleex', {fallback: false}),
        '/KaiserAleex/Springwood/Badham Preeschool.png'
    );
    assert.equal(
        findClosestMapMatch('Ormond/Ormond Lake Mine', catalogLookup, 'SamoelColt', {fallback: false}),
        '/SamoelColt/Ormond/Lake Mine.jpg'
    );
    assert.equal(
        findClosestMapMatch('Red Forest/Temple of Purgation', catalogLookup, 'KaiserAleex', {fallback: false}),
        '/KaiserAleex/Red Forest/The Temple of Purgation.png'
    );
    assert.equal(
        findClosestMapMatch('Hawkins National Laboratory/The Underground Complex', catalogLookup, 'EagerFace', {fallback: false}),
        '/EagerFace/Hawkins National Laboratory/The Undrground Complex.jpg'
    );
});

test('closest name finds a unique realm file when the map is named after the realm', () => {
    assert.equal(
        findClosestMapMatch('Gideon Meat Plant/The Game', catalogLookup, 'StanleyWav', {fallback: false}),
        '/StanleyWav/Gideon Meat Plant/Gideon Meat Plant.gif'
    );
    assert.equal(
        findClosestMapMatch('Crotus Prenn Asylum/Disturbed Ward', catalogLookup, 'SamoelColt', {fallback: false}),
        '/SamoelColt/Disturbed Ward/Crotus Prenn Asylum.jpg'
    );
    assert.equal(
        findClosestMapMatch('Raccoon City/Raccoon City Police Station East Wing', catalogLookup, 'SamoelColt', {fallback: false}),
        '/SamoelColt/Raccoon City/Raccoon City Police Station (Lower Floor).jpg'
    );
    assert.equal(
        findClosestMapMatch('Raccoon City/Raccoon City East (Lower Floor)', catalogLookup, 'Hens333', {fallback: false}),
        '/Hens333/Raccoon City/Raccoon City Police Station East Wing.webp'
    );
});

// parseMapPath — shared Creator/Realm/Map parser (images.js + hotkeys.js)
test('parseMapPath splits a leading-slash Creator/Realm/Map path', () => {
    assert.deepEqual(
        parseMapPath('/SamoelColt/The Macmillan Estate/Coal Tower.png'),
        {creator: 'SamoelColt', realm: 'The Macmillan Estate', map: 'Coal Tower.png', base: 'Coal Tower'}
    );
});

test('parseMapPath splits Windows backslash paths and bare keys', () => {
    assert.deepEqual(
        parseMapPath('\\EagerFace\\The Macmillan Estate\\Coal Tower.png'),
        {creator: 'EagerFace', realm: 'The Macmillan Estate', map: 'Coal Tower.png', base: 'Coal Tower'}
    );
    assert.deepEqual(
        parseMapPath('EagerFace/The Macmillan Estate/Coal Tower.png'),
        {creator: 'EagerFace', realm: 'The Macmillan Estate', map: 'Coal Tower.png', base: 'Coal Tower'}
    );
});

test('parseMapPath buckets flat custom files under Custom', () => {
    assert.deepEqual(
        parseMapPath('/My Custom Map.png'),
        {creator: 'Custom', realm: 'Custom', map: 'My Custom Map.png', base: 'My Custom Map'}
    );
});

test('parseMapPath returns null for empty input', () => {
    assert.equal(parseMapPath(''), null);
    assert.equal(parseMapPath(null), null);
    assert.equal(parseMapPath(undefined), null);
});
