'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.mobiles;
if (!mod) throw new Error('Plugin "mobiles" not found in bundle');
module.exports = mod;
