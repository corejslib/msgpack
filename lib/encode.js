const MICRO_OPT_LEN = 32;

// faster for short strings than buffer.write
function utf8Write ( arr, offset, str ) {
    let c;

    for ( let i = 0, l = str.length; i < l; i++ ) {
        c = str.codePointAt( i );

        if ( c < 0x80 ) {
            arr[ offset++ ] = c;
        }
        else if ( c < 0x8_00 ) {
            arr[ offset++ ] = 0xC0 | ( c >> 6 );
            arr[ offset++ ] = 0x80 | ( c & 0x3F );
        }
        else if ( c < 0xD8_00 || c >= 0xE0_00 ) {
            arr[ offset++ ] = 0xE0 | ( c >> 12 );
            arr[ offset++ ] = 0x80 | ( ( c >> 6 ) & 0x3F );
            arr[ offset++ ] = 0x80 | ( c & 0x3F );
        }
        else {
            i++;
            c = 0x1_00_00 + ( ( ( c & 0x3_FF ) << 10 ) | ( str.codePointAt( i ) & 0x3_FF ) );
            arr[ offset++ ] = 0xF0 | ( c >> 18 );
            arr[ offset++ ] = 0x80 | ( ( c >> 12 ) & 0x3F );
            arr[ offset++ ] = 0x80 | ( ( c >> 6 ) & 0x3F );
            arr[ offset++ ] = 0x80 | ( c & 0x3F );
        }
    }
}

// faster for short strings than Buffer.byteLength
function utf8Length ( str ) {
    let c,
        length = 0;

    for ( let i = 0, l = str.length; i < l; i++ ) {
        c = str.codePointAt( i );
        if ( c < 0x80 ) {
            length += 1;
        }
        else if ( c < 0x8_00 ) {
            length += 2;
        }
        else if ( c < 0xD8_00 || c >= 0xE0_00 ) {
            length += 3;
        }
        else {
            i++;
            length += 4;
        }
    }
    return length;
}

const cache = new Map(),
    cacheMaxSize = 1024;

function encodeKey ( bytes, defers, key ) {
    if ( cache.has( key ) ) {
        const buffer = cache.get( key );
        defers.push( { "bin": buffer, "length": buffer.length, "offset": bytes.length } );
        return buffer.length;
    }
    if ( cache.size > cacheMaxSize ) {
        return _encode( bytes, defers, key );
    }
    const keyBytes = [];
    const size = _encode( keyBytes, [], key );
    const keyBuffer = Buffer.allocUnsafe( size );
    for ( let i = 0, l = keyBytes.length; i < l; i++ ) {
        keyBuffer[ i ] = keyBytes[ i ];
    }
    utf8Write( keyBuffer, keyBytes.length, key );
    defers.push( { "bin": keyBuffer, "length": size, "offset": bytes.length } );
    cache.set( key, keyBuffer );
    return size;
}

function _encode ( bytes, defers, value ) {
    let hi, lo, length, size;

    // string
    if ( typeof value === "string" ) {
        if ( value.length > MICRO_OPT_LEN ) {
            length = Buffer.byteLength( value );
        }
        else {
            length = utf8Length( value );
        }

        if ( length < 0x20 ) {

            // fixstr
            bytes.push( length | 0xA0 );
            size = 1;
        }
        else if ( length < 0x1_00 ) {

            // str 8
            bytes.push( 0xD9, length );
            size = 2;
        }
        else if ( length < 0x1_00_00 ) {

            // str 16
            bytes.push( 0xDA, length >> 8, length );
            size = 3;
        }
        else if ( length < 0x1_00_00_00_00 ) {

            // str 32
            bytes.push( 0xDB, length >> 24, length >> 16, length >> 8, length );
            size = 5;
        }
        else {
            throw new Error( "String too long" );
        }

        defers.push( { "str": value, "length": length, "offset": bytes.length } );

        return size + length;
    }

    // number
    else if ( typeof value === "number" ) {

        // TODO: encode to float 32?

        if ( Math.floor( value ) !== value || !Number.isFinite( value ) ) {

            // float 64
            bytes.push( 0xCB );
            defers.push( { "float": value, "length": 8, "offset": bytes.length } );
            return 9;
        }

        if ( value >= 0 ) {
            if ( value < 0x80 ) {

                // positive fixnum
                bytes.push( value );
                return 1;
            }

            if ( value < 0x1_00 ) {

                // uint 8
                bytes.push( 0xCC, value );
                return 2;
            }

            if ( value < 0x1_00_00 ) {

                // uint 16
                bytes.push( 0xCD, value >> 8, value );
                return 3;
            }

            if ( value < 0x1_00_00_00_00 ) {

                // uint 32
                bytes.push( 0xCE, value >> 24, value >> 16, value >> 8, value );
                return 5;
            }

            // uint 64
            hi = ( value / 2 ** 32 ) >> 0;
            lo = value >>> 0;
            bytes.push( 0xCF, hi >> 24, hi >> 16, hi >> 8, hi, lo >> 24, lo >> 16, lo >> 8, lo );
            return 9;
        }
        else {
            if ( value >= -0x20 ) {

                // negative fixnum
                bytes.push( value );
                return 1;
            }

            if ( value >= -0x80 ) {

                // int 8
                bytes.push( 0xD0, value );
                return 2;
            }

            if ( value >= -0x80_00 ) {

                // int 16
                bytes.push( 0xD1, value >> 8, value );
                return 3;
            }

            if ( value >= -0x80_00_00_00 ) {

                // int 32
                bytes.push( 0xD2, value >> 24, value >> 16, value >> 8, value );
                return 5;
            }

            // int 64
            hi = Math.floor( value / 2 ** 32 );
            lo = value >>> 0;
            bytes.push( 0xD3, hi >> 24, hi >> 16, hi >> 8, hi, lo >> 24, lo >> 16, lo >> 8, lo );
            return 9;
        }
    }

    // object
    else if ( typeof value === "object" ) {

        // null
        if ( value === null ) {
            bytes.push( 0xC0 );

            return 1;
        }

        // Array
        else if ( Array.isArray( value ) ) {
            length = value.length;

            if ( length < 0x10 ) {

                // fixarray
                bytes.push( length | 0x90 );
                size = 1;
            }
            else if ( length < 0x1_00_00 ) {

                // array 16
                bytes.push( 0xDC, length >> 8, length );
                size = 3;
            }
            else if ( length < 0x1_00_00_00_00 ) {

                // array 32
                bytes.push( 0xDD, length >> 24, length >> 16, length >> 8, length );
                size = 5;
            }
            else {
                throw new Error( "Array too large" );
            }

            for ( let i = 0; i < length; i++ ) {
                size += _encode( bytes, defers, value[ i ] );
            }

            return size;
        }

        // Date
        else if ( value instanceof Date ) {
            const time = value.getTime();

            let sec, nano;

            if ( time >= 0 ) {
                sec = Math.trunc( time / 1000 );
                nano = Math.abs( time % 1000 ) * 1_000_000;
            }
            else {
                sec = Math.trunc( time / 1000 ) - 1;
                nano = ( 1000 + ( time % 1000 ) ) * 1_000_000;
            }

            hi = Math.floor( sec / 2 ** 32 );
            lo = sec >>> 0;

            bytes.push( 0xC7, 12, -1, nano >> 24, nano >> 16, nano >> 8, nano, hi >> 24, hi >> 16, hi >> 8, hi, lo >> 24, lo >> 16, lo >> 8, lo );

            return 15;
        }

        // Buffer
        else if ( Buffer.isBuffer( value ) ) {
            length = value.length;

            if ( length < 0x1_00 ) {

                // bin 8
                bytes.push( 0xC4, length );
                size = 2;
            }
            else if ( length < 0x1_00_00 ) {

                // bin 16
                bytes.push( 0xC5, length >> 8, length );
                size = 3;
            }
            else if ( length < 0x1_00_00_00_00 ) {

                // bin 32
                bytes.push( 0xC6, length >> 24, length >> 16, length >> 8, length );
                size = 5;
            }
            else {
                throw new Error( "Buffer too large" );
            }

            defers.push( { "bin": value, "length": length, "offset": bytes.length } );

            return size + length;
        }

        // ArrayBuffer
        else if ( value instanceof ArrayBuffer || ArrayBuffer.isView( value ) ) {
            const arraybuffer = value.buffer || value;
            length = arraybuffer.byteLength;

            // ext 8
            if ( length < 0x1_00 ) {
                bytes.push( 0xC7, length, 0 );
                size = 3;
            }
            else if ( length < 0x1_00_00 ) {

                // ext 16
                bytes.push( 0xC8, length >> 8, length, 0 );
                size = 4;
            }
            else if ( length < 0x1_00_00_00_00 ) {

                // ext 32
                bytes.push( 0xC9, length >> 24, length >> 16, length >> 8, length, 0 );
                size = 6;
            }
            else {
                throw new Error( "ArrayBuffer too large" );
            }

            defers.push( { "arraybuffer": arraybuffer, "length": length, "offset": bytes.length } );

            return size + length;
        }

        // .toJSON() method
        else if ( typeof value.toJSON === "function" ) {
            return _encode( bytes, defers, value.toJSON() );
        }

        // Object
        else {
            const keys = [],
                allKeys = Object.keys( value );

            let key;

            for ( let i = 0, l = allKeys.length; i < l; i++ ) {
                key = allKeys[ i ];
                if ( typeof value[ key ] !== "function" ) {
                    keys.push( key );
                }
            }
            length = keys.length;

            if ( length < 0x10 ) {

                // fixmap
                bytes.push( length | 0x80 );
                size = 1;
            }
            else if ( length < 0x1_00_00 ) {

                // map 16
                bytes.push( 0xDE, length >> 8, length );
                size = 3;
            }
            else if ( length < 0x1_00_00_00_00 ) {

                // map 32
                bytes.push( 0xDF, length >> 24, length >> 16, length >> 8, length );
                size = 5;
            }
            else {
                throw new Error( "Object too large" );
            }

            for ( let i = 0; i < length; i++ ) {
                key = keys[ i ];
                size += encodeKey( bytes, defers, key );
                size += _encode( bytes, defers, value[ key ] );
            }

            return size;
        }
    }

    // Boolean
    else if ( typeof value === "boolean" ) {
        bytes.push( value
            ? 0xC3
            : 0xC2 );

        return 1;
    }

    // undefined
    else if ( typeof value === "undefined" ) {
        bytes.push( 0xD4, 0, 0 );

        return 3;
    }

    // BigInt
    else if ( typeof value === "bigint" ) {
        value = value.toString();

        length = value.length;

        // ext 8
        if ( length < 0x1_00 ) {
            bytes.push( 0xC7, length, 1 );
            size = 3;
        }

        // ext 16
        else if ( length < 0x1_00_00 ) {
            bytes.push( 0xC8, length >> 8, length, 1 );
            size = 4;
        }

        // ext 32
        else if ( length < 0x1_00_00_00_00 ) {
            bytes.push( 0xC9, length >> 24, length >> 16, length >> 8, length, 1 );
            size = 6;
        }
        else {
            throw new Error( "BigInt too large" );
        }

        defers.push( { "str": value, "length": length, "offset": bytes.length } );

        return size + length;
    }

    // unsupported data type
    else {
        throw new Error( "Could not encode" );
    }
}

export default function encode ( value, encoding ) {
    const bytes = [],
        defers = [],
        size = _encode( bytes, defers, value ),
        buf = Buffer.allocUnsafe( size );

    let deferIndex = 0,
        deferWritten = 0,
        nextOffset = -1;
    if ( defers.length > 0 ) {
        nextOffset = defers[ 0 ].offset;
    }

    let defer, deferLength, offset;

    for ( let i = 0, l = bytes.length; i < l; i++ ) {
        buf[ deferWritten + i ] = bytes[ i ];

        while ( i + 1 === nextOffset ) {
            defer = defers[ deferIndex ];
            deferLength = defer.length;
            offset = deferWritten + nextOffset;
            if ( defer.bin ) {
                if ( deferLength > MICRO_OPT_LEN ) {
                    defer.bin.copy( buf, offset, 0, deferLength );
                }
                else {
                    const bin = defer.bin;
                    for ( let j = 0; j < deferLength; j++ ) {
                        buf[ offset + j ] = bin[ j ];
                    }
                }
            }
            else if ( defer.str ) {
                if ( deferLength > MICRO_OPT_LEN ) {
                    buf.write( defer.str, offset, deferLength, "utf8" );
                }
                else {
                    utf8Write( buf, offset, defer.str );
                }
            }
            else if ( defer.float !== undefined ) {
                buf.writeDoubleBE( defer.float, offset );
            }
            else if ( defer.arraybuffer ) {
                const arr = new Uint8Array( defer.arraybuffer );
                for ( let k = 0; k < deferLength; k++ ) {
                    buf[ offset + k ] = arr[ k ];
                }
            }
            deferIndex++;
            deferWritten += deferLength;
            if ( defers[ deferIndex ] ) {
                nextOffset = defers[ deferIndex ].offset;
            }
            else {
                break;
            }
        }
    }

    if ( encoding ) {
        return buf.toString( encoding );
    }
    else {
        return buf;
    }
}
