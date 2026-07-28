#!/usr/bin/env node

import { printResult, validatePluginManifest } from "./repo-policy.mjs";

const { errors } = validatePluginManifest();
if (!printResult("plugin manifest", errors)) process.exitCode = 1;
