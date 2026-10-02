#!/usr/bin/env -S node

import decode from "../lib/_browser/decode.js";
import encode from "../lib/_browser/encode.js";
import { runCodecTests } from "./codec.js";

runCodecTests( "Browser codec", encode, decode, data => data.buffer, [ 0xC4, 0xC5, 0xC6 ] );
