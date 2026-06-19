'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.real_estate;
if (!mod) throw new Error('Plugin "real_estate" not found in bundle');
module.exports = mod;
