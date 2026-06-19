'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.crm;
if (!mod) throw new Error('Plugin "crm" not found in bundle');
module.exports = mod;
