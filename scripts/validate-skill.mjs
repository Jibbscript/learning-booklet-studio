#!/usr/bin/env node

import { printResult, validatePublicSkill } from "./repo-policy.mjs";

const { errors } = validatePublicSkill();
if (!printResult("public skill", errors)) process.exitCode = 1;
