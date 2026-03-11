import DecodeKeyCache from "./decode-key-cache.js";

const cache = new DecodeKeyCache();

class Decoder {
    #buffer;
    #offset;
    #useKeyCache = false;
    #rangeError;

    constructor ( buffer, offset ) {
        this.#buffer = buffer;
        this.#offset = offset || 0;
    }

    // properties
    get offset () {
        return this.#offset;
    }

    get rangeError () {
        return this.#rangeError;
    }

    // public
    parse () {
        if ( this.#buffer.length < this.#offset + 1 ) {
            this.#throwRangeError();
        }

        const prefix = this.#buffer[ this.#offset++ ];

        let value, length, type, hi, lo;

        if ( prefix < 0xC0 ) {

            // positive fixint
            if ( prefix < 0x80 ) {
                return prefix;
            }

            // fixmap
            if ( prefix < 0x90 ) {
                return this.#map( prefix & 0x0F );
            }

            // fixarray
            if ( prefix < 0xA0 ) {
                return this.#array( prefix & 0x0F );
            }

            // fixstr
            return this.#str( prefix & 0x1F );
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
            length = this.#buffer.readUInt8( this.#offset );
            this.#offset += 1;

            return this.#bin( length );
        }
        else if ( prefix === 0xC5 ) {
            length = this.#buffer.readUInt16BE( this.#offset );
            this.#offset += 2;

            return this.#bin( length );
        }
        else if ( prefix === 0xC6 ) {
            length = this.#buffer.readUInt32BE( this.#offset );
            this.#offset += 4;

            return this.#bin( length );
        }

        // ext
        else if ( prefix === 0xC7 ) {
            length = this.#buffer.readUInt8( this.#offset );
            type = this.#buffer.readInt8( this.#offset + 1 );
            this.#offset += 2;

            // Date
            if ( type === -1 ) {
                const date = new Date( this.#buffer.readUInt32BE( this.#offset ) / 1_000_000 + Number( this.#buffer.readBigInt64BE( this.#offset + 4 ) ) * 1000 );

                this.#offset += 12;

                return date;
            }

            // ArrayBuffer
            else if ( type === 0 ) {
                return this.#arraybuffer( length );
            }

            // BigInt
            else if ( type === 1 ) {
                return BigInt( this.#str( length ) );
            }

            return [ type, this.#bin( length ) ];
        }
        else if ( prefix === 0xC8 ) {
            length = this.#buffer.readUInt16BE( this.#offset );
            type = this.#buffer.readInt8( this.#offset + 2 );
            this.#offset += 3;

            // ArrayBuffer
            if ( type === 0 ) {
                return this.#arraybuffer( length );
            }

            // bigint
            else if ( type === 1 ) {
                return BigInt( this.#str( length ) );
            }

            return [ type, this.#bin( length ) ];
        }
        else if ( prefix === 0xC9 ) {
            length = this.#buffer.readUInt32BE( this.#offset );
            type = this.#buffer.readInt8( this.#offset + 4 );
            this.#offset += 5;

            // ArrayBuffer
            if ( type === 0 ) {
                return this.#arraybuffer( length );
            }

            // BigInt
            else if ( type === 1 ) {
                return BigInt( this.#str( length ) );
            }

            return [ type, this.#bin( length ) ];
        }

        // float
        else if ( prefix === 0xCA ) {
            value = this.#buffer.readFloatBE( this.#offset );
            this.#offset += 4;

            return value;
        }
        else if ( prefix === 0xCB ) {
            value = this.#buffer.readDoubleBE( this.#offset );
            this.#offset += 8;

            return value;
        }

        // uint
        else if ( prefix === 0xCC ) {
            value = this.#buffer.readUInt8( this.#offset );
            this.#offset += 1;

            return value;
        }
        else if ( prefix === 0xCD ) {
            value = this.#buffer.readUInt16BE( this.#offset );
            this.#offset += 2;

            return value;
        }
        else if ( prefix === 0xCE ) {
            value = this.#buffer.readUInt32BE( this.#offset );
            this.#offset += 4;

            return value;
        }
        else if ( prefix === 0xCF ) {
            hi = this.#buffer.readUInt32BE( this.#offset ) * 2 ** 32;
            lo = this.#buffer.readUInt32BE( this.#offset + 4 );
            this.#offset += 8;

            return hi + lo;
        }

        // int
        else if ( prefix === 0xD0 ) {
            value = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;

            return value;
        }
        else if ( prefix === 0xD1 ) {
            value = this.#buffer.readInt16BE( this.#offset );
            this.#offset += 2;

            return value;
        }
        else if ( prefix === 0xD2 ) {
            value = this.#buffer.readInt32BE( this.#offset );
            this.#offset += 4;

            return value;
        }
        else if ( prefix === 0xD3 ) {
            hi = this.#buffer.readInt32BE( this.#offset ) * 2 ** 32;
            lo = this.#buffer.readUInt32BE( this.#offset + 4 );
            this.#offset += 8;

            return hi + lo;
        }

        // fixext
        else if ( prefix === 0xD4 ) {
            type = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;
            if ( type === 0x00 ) {
                this.#offset += 1;
                return void 0;
            }

            return [ type, this.#bin( 1 ) ];
        }
        else if ( prefix === 0xD5 ) {
            type = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;

            return [ type, this.#bin( 2 ) ];
        }
        else if ( prefix === 0xD6 ) {
            type = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;

            return [ type, this.#bin( 4 ) ];
        }
        else if ( prefix === 0xD7 ) {
            type = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;

            return [ type, this.#bin( 8 ) ];
        }
        else if ( prefix === 0xD8 ) {
            type = this.#buffer.readInt8( this.#offset );
            this.#offset += 1;

            return [ type, this.#bin( 16 ) ];
        }

        // str
        else if ( prefix === 0xD9 ) {
            length = this.#buffer.readUInt8( this.#offset );
            this.#offset += 1;

            return this.#str( length );
        }
        else if ( prefix === 0xDA ) {
            length = this.#buffer.readUInt16BE( this.#offset );
            this.#offset += 2;

            return this.#str( length );
        }
        else if ( prefix === 0xDB ) {
            length = this.#buffer.readUInt32BE( this.#offset );
            this.#offset += 4;

            return this.#str( length );
        }

        // array
        else if ( prefix === 0xDC ) {
            length = this.#buffer.readUInt16BE( this.#offset );
            this.#offset += 2;

            return this.#array( length );
        }
        else if ( prefix === 0xDD ) {
            length = this.#buffer.readUInt32BE( this.#offset );
            this.#offset += 4;

            return this.#array( length );
        }

        // map
        else if ( prefix === 0xDE ) {
            length = this.#buffer.readUInt16BE( this.#offset );
            this.#offset += 2;

            return this.#map( length );
        }
        else if ( prefix === 0xDF ) {
            length = this.#buffer.readUInt32BE( this.#offset );
            this.#offset += 4;

            return this.#map( length );
        }

        throw new Error( "MessagePack could not parse message" );
    }

    // private
    #array ( length ) {
        const value = new Array( length );

        for ( let i = 0; i < length; i++ ) {
            value[ i ] = this.parse();
        }

        return value;
    }

    #map ( length ) {
        let key;

        const value = {};

        for ( let i = 0; i < length; i++ ) {
            this.#useKeyCache = true;

            key = this.parse();

            this.#useKeyCache = false;

            value[ key ] = this.parse();
        }

        return value;
    }

    #str ( length ) {
        if ( this.#buffer.length < this.#offset + length ) {
            this.#throwRangeError();
        }

        if ( this.#useKeyCache ) {
            const valueFromCache = cache.get( this.#buffer, this.#offset, length );

            if ( valueFromCache ) {
                this.#offset += length;
                return valueFromCache;
            }
        }

        const value = this.#buffer.toString( "utf8", this.#offset, this.#offset + length );

        if ( this.#useKeyCache ) {
            cache.set( this.#buffer, this.#offset, length, value );
        }

        this.#offset += length;

        return value;
    }

    #bin ( length ) {
        if ( this.#buffer.length < this.#offset + length ) {
            this.#throwRangeError();
        }

        const value = this.#buffer.subarray( this.#offset, this.#offset + length );

        this.#offset += length;

        return value;
    }

    #arraybuffer ( length ) {
        if ( this.#buffer.length < this.#offset + length ) {
            this.#throwRangeError();
        }

        const buffer = new ArrayBuffer( length ),
            view = new Uint8Array( buffer );

        for ( let j = 0; j < length; j++ ) {
            view[ j ] = this.#buffer[ this.#offset + j ];
        }

        this.#offset += length;

        return buffer;
    }

    #throwRangeError () {
        this.#rangeError = true;

        throw new Error( "MessagePack message in not complete" );
    }
}

export default function decode ( buffer, encoding ) {
    if ( typeof buffer === "string" ) {
        buffer = Buffer.from( buffer, encoding );
    }
    else if ( buffer instanceof ArrayBuffer || buffer instanceof Uint8Array ) {
        buffer = Buffer.from( buffer );
    }

    const decoder = new Decoder( buffer );

    const value = decoder.parse();

    if ( decoder.offset > buffer.length ) {
        throw new Error( "MessagePack data is incomplete" );
    }
    else if ( decoder.offset < buffer.length ) {
        throw new Error( "MessagePack data contains extra bytes" );
    }
    else {
        return value;
    }
}

export function decodeStream ( buffer, offset ) {
    const decoder = new Decoder( buffer, offset );

    try {
        var value = decoder.parse();
    }
    catch ( e ) {

        // message is incomplete
        if ( decoder.rangeError || e.code === "ERR_BUFFER_OUT_OF_BOUNDS" || e.code === "ERR_OUT_OF_RANGE" ) {
            return;
        }

        throw e;
    }

    return {
        value,
        "offset": decoder.offset,
    };
}
