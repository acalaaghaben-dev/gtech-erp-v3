'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.ngo;
if (!mod) throw new Error('Plugin "ngo" not found in bundle');
module.exports = mod;
