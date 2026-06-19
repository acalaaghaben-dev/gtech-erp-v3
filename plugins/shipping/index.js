'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.shipping;
if (!mod) throw new Error('Plugin "shipping" not found in bundle');
module.exports = mod;
