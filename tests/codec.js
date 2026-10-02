import { deepStrictEqual, ok, throws } from "node:assert";
import { suite, test } from "node:test";

function getBytes ( value ) {
    return value instanceof ArrayBuffer
        ? new Uint8Array( value )
        : value;
}

function getPayloadBytes ( value ) {
    return Array.from( value );
}

function lengthHeader ( length, fix, fixLimit, marker8, marker16, marker32 ) {
    if ( length < fixLimit ) {
        return [ fix | length ];
    }
    else if ( length < 0x100 ) {
        return [ marker8, length ];
    }
    else if ( length < 0x10000 ) {
        return [ marker16, length >> 8, length ];
    }
    else {
        return [ marker32, length >> 24, length >> 16, length >> 8, length ];
    }
}

function assertEncodedPrefix ( encode, value, expected ) {
    const bytes = getBytes( encode( value ) );

    deepStrictEqual(
        Array.from( bytes.subarray( 0, expected.length ) ),
        expected.map( byte => byte & 0xFF )
    );

    return bytes;
}

function runCodecTests ( name, encode, decode, binaryFactory, binaryMarkers ) {
    suite( name, () => {
        suite( "primitive values", () => {
            const integers = [
                [ 0, 0x00 ],
                [ 127, 0x7F ],
                [ 128, 0xCC ],
                [ 255, 0xCC ],
                [ 256, 0xCD ],
                [ 65_535, 0xCD ],
                [ 65_536, 0xCE ],
                [ 0xFFFF_FFFF, 0xCE ],
                [ 0x1_0000_0000, 0xCF ],
                [ Number.MAX_SAFE_INTEGER, 0xCF ],
                [ -1, 0xFF ],
                [ -32, 0xE0 ],
                [ -33, 0xD0 ],
                [ -128, 0xD0 ],
                [ -129, 0xD1 ],
                [ -32_768, 0xD1 ],
                [ -32_769, 0xD2 ],
                [ -0x8000_0000, 0xD2 ],
                [ -0x8000_0001, 0xD3 ],
                [ Number.MIN_SAFE_INTEGER, 0xD3 ],
            ];

            for ( const [ value, marker ] of integers ) {
                test( `integer ${ value }`, () => {
                    const bytes = assertEncodedPrefix( encode, value, [ marker ] );

                    deepStrictEqual( decode( bytes ), value );
                } );
            }

            const values = [
                [ null, [ 0xC0 ] ],
                [ false, [ 0xC2 ] ],
                [ true, [ 0xC3 ] ],
                [ undefined, [ 0xD4, 0x00, 0x00 ] ],
                [ 1.5, [ 0xCB ] ],
                [ -1.25, [ 0xCB ] ],
                [ Infinity, [ 0xCB ] ],
                [ -Infinity, [ 0xCB ] ],
                [ NaN, [ 0xCB ] ],
            ];

            for ( const [ value, prefix ] of values ) {
                test( `value ${ String( value ) }`, () => {
                    const bytes = assertEncodedPrefix( encode, value, prefix ),
                        result = decode( bytes );

                    if ( Number.isNaN( value ) ) {
                        ok( Number.isNaN( result ) );
                    }
                    else {
                        deepStrictEqual( result, value );
                    }
                } );
            }

            test( "negative zero is encoded as positive fixint zero", () => {
                const bytes = assertEncodedPrefix( encode, -0, [ 0x00 ] );

                deepStrictEqual( decode( bytes ), 0 );
            } );

            test( "decodes float32 and every integer wire width", () => {
                const vectors = [
                    [ [ 0xCA, 0x3F, 0xC0, 0x00, 0x00 ], 1.5 ],
                    [ [ 0xCC, 0xFF ], 255 ],
                    [ [ 0xCD, 0xFF, 0xFF ], 65_535 ],
                    [ [ 0xCE, 0xFF, 0xFF, 0xFF, 0xFF ], 0xFFFF_FFFF ],
                    [ [ 0xCF, 0x00, 0x1F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF ], Number.MAX_SAFE_INTEGER ],
                    [ [ 0xD0, 0x80 ], -128 ],
                    [ [ 0xD1, 0x80, 0x00 ], -32_768 ],
                    [ [ 0xD2, 0x80, 0x00, 0x00, 0x00 ], -0x8000_0000 ],
                    [ [ 0xD3, 0xFF, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 ], Number.MIN_SAFE_INTEGER ],
                ];

                for ( const [ bytes, value ] of vectors ) {
                    deepStrictEqual( decode( Uint8Array.from( bytes ) ), value );
                }
            } );
        } );

        suite( "string lengths", () => {
            for ( const length of [ 0, 1, 31, 32, 255, 256, 65_535, 65_536 ] ) {
                test( `UTF-8 length ${ length }`, () => {
                    const value = "a".repeat( length ),
                        header = lengthHeader( length, 0xA0, 0x20, 0xD9, 0xDA, 0xDB ),
                        bytes = assertEncodedPrefix( encode, value, header );

                    deepStrictEqual( decode( bytes ), value );
                } );
            }

            test( "uses UTF-8 byte length for multibyte characters", () => {
                for ( const value of [ "é".repeat( 16 ), "😀".repeat( 8 ) ] ) {
                    const bytes = getBytes( encode( value ) );

                    deepStrictEqual( bytes[ 0 ], 0xD9 );
                    deepStrictEqual( decode( bytes ), value );
                }
            } );
        } );

        suite( "binary lengths", () => {
            for ( const length of [ 0, 1, 255, 256, 65_535, 65_536 ] ) {
                test( `binary length ${ length }`, () => {
                    const data = Uint8Array.from( { "length": length }, ( _, index ) => index & 0xFF ),
                        value = binaryFactory( data ),
                        header = lengthHeader( length, 0, 0, binaryMarkers[ 0 ], binaryMarkers[ 1 ], binaryMarkers[ 2 ] ),
                        bytes = assertEncodedPrefix( encode, value, header ),
                        result = decode( bytes );

                    deepStrictEqual( getPayloadBytes( result ), Array.from( data ) );
                } );
            }
        } );

        suite( "array and map lengths", () => {
            for ( const length of [ 0, 1, 15, 16, 65_535, 65_536 ] ) {
                test( `array length ${ length }`, () => {
                    const value = new Array( length ).fill( 0 ),
                        header = length < 0x10
                            ? [ 0x90 | length ]
                            : length < 0x10000
                                ? [ 0xDC, length >> 8, length ]
                                : [ 0xDD, length >> 24, length >> 16, length >> 8, length ],
                        bytes = assertEncodedPrefix( encode, value, header ),
                        result = decode( bytes );

                    deepStrictEqual( result.length, length );
                    if ( length > 0 ) {
                        deepStrictEqual( result[ length - 1 ], 0 );
                    }
                } );

                test( `map length ${ length }`, () => {
                    const value = {};
                    for ( let i = 0; i < length; i++ ) {
                        value[ `k${ i }` ] = 0;
                    }

                    const header = length < 0x10
                            ? [ 0x80 | length ]
                            : length < 0x10000
                                ? [ 0xDE, length >> 8, length ]
                                : [ 0xDF, length >> 24, length >> 16, length >> 8, length ],
                        bytes = assertEncodedPrefix( encode, value, header ),
                        result = decode( bytes );

                    deepStrictEqual( Object.keys( result ).length, length );
                    if ( length > 0 ) {
                        deepStrictEqual( result[ `k${ length - 1 }` ], 0 );
                    }
                } );
            }
        } );

        suite( "extensions and custom types", () => {
            test( "round-trips dates, including pre-epoch timestamps", () => {
                for ( const value of [ new Date( 0 ), new Date( 1_700_000_000_123 ), new Date( -1234 ) ] ) {
                    const bytes = assertEncodedPrefix( encode, value, [ 0xC7, 0x0C, 0xFF ] );

                    deepStrictEqual( decode( bytes ), value );
                }
            } );

            test( "round-trips BigInt with ext8 and ext16 payload lengths", () => {
                for ( const value of [ 0n, -12_345_678_901_234_567_890n, BigInt( `1${ "0".repeat( 255 ) }` ) ] ) {
                    const bytes = getBytes( encode( value ) ),
                        expectedMarker = value.toString().length < 0x100
                            ? 0xC7
                            : 0xC8;

                    deepStrictEqual( bytes[ 0 ], expectedMarker );
                    deepStrictEqual( decode( bytes ), value );
                }
            } );

            for ( const [ marker, length ] of [
                [ 0xD4, 1 ],
                [ 0xD5, 2 ],
                [ 0xD6, 4 ],
                [ 0xD7, 8 ],
                [ 0xD8, 16 ],
            ] ) {
                test( `decodes fixext payload length ${ length }`, () => {
                    const bytes = Uint8Array.from( [ marker, 0x02, ...new Array( length ).fill( 0xA5 ) ] ),
                        result = decode( bytes );

                    deepStrictEqual( result[ 0 ], 2 );
                    deepStrictEqual( getPayloadBytes( result[ 1 ] ), new Array( length ).fill( 0xA5 ) );
                } );
            }

            for ( const length of [ 0, 1, 255, 256, 65_536 ] ) {
                test( `decodes ext payload length ${ length }`, () => {
                    const header = length < 0x100
                            ? [ 0xC7, length, 0xFE ]
                            : length < 0x10000
                                ? [ 0xC8, length >> 8, length, 0xFE ]
                                : [ 0xC9, length >> 24, length >> 16, length >> 8, length, 0xFE ],
                        bytes = Uint8Array.from( [ ...header, ...new Array( length ).fill( 0x5A ) ] ),
                        result = decode( bytes );

                    deepStrictEqual( result[ 0 ], -2 );
                    deepStrictEqual( getPayloadBytes( result[ 1 ] ), new Array( length ).fill( 0x5A ) );
                } );
            }
        } );

        suite( "nested and decoder input behavior", () => {
            test( "round-trips nested values and omits object functions", () => {
                const value = {
                        "items": [ 1, null, true, "hello" ],
                        "nested": { "ok": false },
                        "ignored": () => 1,
                    },
                    result = decode( encode( value ) );

                deepStrictEqual( result, {
                    "items": [ 1, null, true, "hello" ],
                    "nested": { "ok": false },
                } );
            } );

            test( "decodes a nonzero-offset typed-array view", () => {
                const encoded = getBytes( encode( "view" ) ),
                    padded = new Uint8Array( encoded.length + 4 );

                padded.set( encoded, 2 );
                deepStrictEqual( decode( padded.subarray( 2, 2 + encoded.length ) ), "view" );
            } );

            test( "rejects reserved marker and trailing bytes", () => {
                throws( () => decode( Uint8Array.from( [ 0xC1 ] ) ) );
                throws( () => decode( Uint8Array.from( [ 0x00, 0x00 ] ) ) );
            } );
        } );
    } );
}

export { runCodecTests };
