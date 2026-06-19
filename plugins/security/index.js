'use strict';
const bundle = require('../_bundle/index.js');
const mod = bundle.security;
if (!mod) throw new Error('Plugin "security" not found in bundle');
module.exports = mod;
