'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.contracting;
if (!mod) throw new Error('Plugin "contracting" not found in bundle');
module.exports = mod;
