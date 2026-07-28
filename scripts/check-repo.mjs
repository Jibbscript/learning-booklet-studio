#!/usr/bin/env node

import { collectRepositoryChecks, printResult } from "./repo-policy.mjs";

const { errors } = collectRepositoryChecks();
if (!printResult("repository policy", errors)) process.exitCode = 1;
