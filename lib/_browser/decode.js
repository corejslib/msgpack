function utf8Read ( view, offset, length ) {
    var string = "",
        chr;

    for ( var i = offset, end = offset + length; i < end; i++ ) {
        var byte = view.getUint8( i );

        if ( ( byte & 0x80 ) === 0x00 ) {
            string += String.fromCodePoint( byte );

            continue;
        }

        if ( ( byte & 0xE0 ) === 0xC0 ) {
            string += String.fromCodePoint( ( ( byte & 0x1F ) << 6 ) | ( view.getUint8( ++i ) & 0x3F ) );

            continue;
        }

        if ( ( byte & 0xF0 ) === 0xE0 ) {
            string += String.fromCodePoint( ( ( byte & 0x0F ) << 12 ) | ( ( view.getUint8( ++i ) & 0x3F ) << 6 ) | ( ( view.getUint8( ++i ) & 0x3F ) << 0 ) );

            continue;
        }

        if ( ( byte & 0xF8 ) === 0xF0 ) {
            chr = ( ( byte & 0x07 ) << 18 ) | ( ( view.getUint8( ++i ) & 0x3F ) << 12 ) | ( ( view.getUint8( ++i ) & 0x3F ) << 6 ) | ( ( view.getUint8( ++i ) & 0x3F ) << 0 );

            if ( chr >= 0x010000 ) {

                // surrogate pair
                chr -= 0x010000;
                string += String.fromCodePoint( ( chr >>> 10 ) + 0xD800, ( chr & 0x3FF ) + 0xDC00 );
            }
            else {
                string += String.fromCodePoint( chr );
            }

            continue;
        }

        throw new Error( "Invalid byte " + byte.toString( 16 ) );
    }
    return string;
}

class Decoder {
    _offset = 0;

    constructor ( buffer ) {
        if ( buffer instanceof ArrayBuffer ) {
            this._buffer = buffer;
            this._view = new DataView( this._buffer );
        }
        else if ( ArrayBuffer.isView( buffer ) ) {
            this._buffer = buffer.buffer;
            this._view = new DataView( this._buffer, buffer.byteOffset, buffer.byteLength );
        }
        else {
            throw new Error( "Invalid argument" );
        }
    }

    // protected
    _array ( length ) {
        var value = new Array( length );
        for ( var i = 0; i < length; i++ ) {
            value[ i ] = this._parse();
        }
        return value;
    }

    _map ( length ) {
        var key,
            value = {};

        for ( var i = 0; i < length; i++ ) {
            key = this._parse();

            value[ key ] = this._parse();
        }

        return value;
    }

    _str ( length ) {
        var value = utf8Read( this._view, this._offset, length );
        this._offset += length;
        return value;
    }

    _bin ( length ) {
        var value = this._buffer.subarray( this._offset, this._offset + length );
        this._offset += length;
        return value;
    }

    _parse () {
        var prefix = this._view.getUint8( this._offset++ );
        var value, length, type, hi, lo;

        if ( prefix < 0xC0 ) {

            // positive fixint
            if ( prefix < 0x80 ) {
                return prefix;
            }

            // fixmap
            if ( prefix < 0x90 ) {
                return this._map( prefix & 0x0F );
            }

            // fixarray
            if ( prefix < 0xA0 ) {
                return this._array( prefix & 0x0F );
            }

            // fixstr
            return this._str( prefix & 0x1F );
        }

        // negative fixint
        if ( prefix > 0xDF ) {
            return ( 0xFF - prefix + 1 ) * -1;
        }

        // nil
        if ( prefix === 0xC0 ) {
            return null;
        }

        // false
        else if ( prefix === 0xC2 ) {
            return false;
        }

        // true
        else if ( prefix === 0xC3 ) {
            return true;
        }

        // bin
        else if ( prefix === 0xC4 ) {
            length = this._view.getUint8( this._offset );
            this._offset += 1;

            return this._bin( length );
        }
        else if ( prefix === 0xC5 ) {
            length = this._view.getUint16( this._offset );
            this._offset += 2;

            return this._bin( length );
        }
        else if ( prefix === 0xC6 ) {
            length = this._view.getUint32( this._offset );
            this._offset += 4;

            return this._bin( length );
        }

        // ext
        else if ( prefix === 0xC7 ) {
            length = this._view.getUint8( this._offset );
            type = this._view.getInt8( this._offset + 1 );
            this._offset += 2;

            if ( type === -1 ) {
                const date = new Date( this._view.getUint32( this._offset ) / 1_000_000 + Number( this._view.getBigInt64( this._offset + 4 ) ) * 1000 );

                this._offset += 12;

                return date;
            }

            // BigInt
            else if ( type === 0x01 ) {
                return BigInt( this._str( length ) );
            }

            return [ type, this._bin( length ) ];
        }
        else if ( prefix === 0xC8 ) {
            length = this._view.getUint16( this._offset );
            type = this._view.getInt8( this._offset + 2 );
            this._offset += 3;

            // BigInt
            if ( type === 0x01 ) {
                return BigInt( this._str( length ) );
            }

            return [ type, this._bin( length ) ];
        }
        else if ( prefix === 0xC9 ) {
            length = this._view.getUint32( this._offset );
            type = this._view.getInt8( this._offset + 4 );
            this._offset += 5;

            // BigInt
            if ( type === 0x01 ) {
                return BigInt( this._str( length ) );
            }

            return [ type, this._bin( length ) ];
        }

        // float
        else if ( prefix === 0xCA ) {
            value = this._view.getFloat32( this._offset );
            this._offset += 4;

            return value;
        }
        else if ( prefix === 0xCB ) {
            value = this._view.getFloat64( this._offset );
            this._offset += 8;

            return value;
        }

        // uint
        else if ( prefix === 0xCC ) {
            value = this._view.getUint8( this._offset );
            this._offset += 1;

            return value;
        }
        else if ( prefix === 0xCD ) {
            value = this._view.getUint16( this._offset );
            this._offset += 2;

            return value;
        }
        else if ( prefix === 0xCE ) {
            value = this._view.getUint32( this._offset );
            this._offset += 4;

            return value;
        }
        else if ( prefix === 0xCF ) {
            hi = this._view.getUint32( this._offset ) * 2 ** 32;
            lo = this._view.getUint32( this._offset + 4 );
            this._offset += 8;

            return hi + lo;
        }

        // int
        else if ( prefix === 0xD0 ) {
            value = this._view.getInt8( this._offset );
            this._offset += 1;

            return value;
        }
        else if ( prefix === 0xD1 ) {
            value = this._view.getInt16( this._offset );
            this._offset += 2;

            return value;
        }
        else if ( prefix === 0xD2 ) {
            value = this._view.getInt32( this._offset );
            this._offset += 4;

            return value;
        }
        else if ( prefix === 0xD3 ) {
            hi = this._view.getInt32( this._offset ) * 2 ** 32;
            lo = this._view.getUint32( this._offset + 4 );
            this._offset += 8;

            return hi + lo;
        }

        // fixext
        else if ( prefix === 0xD4 ) {
            type = this._view.getInt8( this._offset );
            this._offset += 1;
            if ( type === 0x00 ) {
                this._offset += 1;
                return void 0;
            }

            return [ type, this._bin( 1 ) ];
        }
        else if ( prefix === 0xD5 ) {
            type = this._view.getInt8( this._offset );
            this._offset += 1;

            return [ type, this._bin( 2 ) ];
        }
        else if ( prefix === 0xD6 ) {
            type = this._view.getInt8( this._offset );
            this._offset += 1;

            return [ type, this._bin( 4 ) ];
        }
        else if ( prefix === 0xD7 ) {
            type = this._view.getInt8( this._offset );
            this._offset += 1;

            return [ type, this._bin( 8 ) ];
        }
        else if ( prefix === 0xD8 ) {
            type = this._view.getInt8( this._offset );
            this._offset += 1;

            return [ type, this._bin( 16 ) ];
        }

        // str
        else if ( prefix === 0xD9 ) {
            length = this._view.getUint8( this._offset );
            this._offset += 1;

            return this._str( length );
        }
        else if ( prefix === 0xDA ) {
            length = this._view.getUint16( this._offset );
            this._offset += 2;

            return this._str( length );
        }
        else if ( prefix === 0xDB ) {
            length = this._view.getUint32( this._offset );
            this._offset += 4;

            return this._str( length );
        }

        // array
        else if ( prefix === 0xDC ) {
            length = this._view.getUint16( this._offset );
            this._offset += 2;

            return this._array( length );
        }
        else if ( prefix === 0xDD ) {
            length = this._view.getUint32( this._offset );
            this._offset += 4;

            return this._array( length );
        }

        // map
        else if ( prefix === 0xDE ) {
            length = this._view.getUint16( this._offset );
            this._offset += 2;

            return this._map( length );
        }
        else if ( prefix === 0xDF ) {
            length = this._view.getUint32( this._offset );
            this._offset += 4;

            return this._map( length );
        }

        throw new Error( "Could not parse" );
    }
}

export default function decode ( buffer ) {
    const decoder = new Decoder( buffer );

    const value = decoder._parse();

    if ( decoder._offset !== buffer.byteLength ) {
        throw new Error( buffer.byteLength - decoder._offset + " trailing bytes" );
    }

    return value;
}

export function decodeStream ( buffer ) {
    return decode( buffer );
}
