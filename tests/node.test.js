#!/usr/bin/env -S node

import { deepStrictEqual } from "node:assert";
import { suite, test } from "node:test";
import decode from "../lib/decode.js";
import encode from "../lib/encode.js";
import { runCodecTests } from "./codec.js";

runCodecTests( "Node codec", encode, decode, data => Buffer.from( data ), [ 0xC4, 0xC5, 0xC6 ] );

suite( "Node ArrayBuffer extension", () => {
    for ( const length of [ 0, 1, 255, 256, 65_535, 65_536 ] ) {
        test( `encodes and decodes ArrayBuffer length ${ length }`, () => {
            const data = Uint8Array.from( { "length": length }, ( _, index ) => index & 0xFF ),
                value = data.buffer,
                bytes = encode( value ),
                marker = length < 0x100
                    ? [ 0xC7, length, 0x00 ]
                    : length < 0x10000
                        ? [ 0xC8, length >> 8, length, 0x00 ]
                        : [ 0xC9, length >> 24, length >> 16, length >> 8, length, 0x00 ],
                result = decode( bytes );

            deepStrictEqual(
                Array.from( bytes.subarray( 0, marker.length ) ),
                marker.map( byte => byte & 0xFF )
            );
            deepStrictEqual( Array.from( new Uint8Array( result ) ), Array.from( data ) );
        } );
    }
} );
