'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.veterinary;
if (!mod) throw new Error('Plugin "veterinary" not found in bundle');
module.exports = mod;
