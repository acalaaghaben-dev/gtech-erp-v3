'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.logistics;
if (!mod) throw new Error('Plugin "logistics" not found in bundle');
module.exports = mod;
