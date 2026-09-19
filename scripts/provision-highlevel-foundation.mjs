#!/usr/bin/env node
import { HighLevelFoundationProvisioner } from '../src/highlevel-provisioning.mjs';

const apply = process.argv.slice(2).includes('--apply');
const result = await new HighLevelFoundationProvisioner().provision({ apply });
// Deliberately emit only location, created object types, IDs, and field keys — never headers, token, or raw responses.
console.log(JSON.stringify(result, null, 2));
