'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.medical;
if (!mod) throw new Error('Plugin "medical" not found in bundle');
module.exports = mod;
