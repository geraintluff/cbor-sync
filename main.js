var stream = require('stream');

var CBOR = (function () {
	var semanticEncoders = [];
	var semanticDecoders = {};
	
	var notImplemented = function () {throw new Error('Not implemented');};
	
	function Reader() {
	}
	Reader.prototype = {
		peekByte: notImplemented,
		readByte: notImplemented,
		readChunk: notImplemented,
		readUint16: function () {
			return this.readByte()*256 + this.readByte();
		},
		readUint32: function () {
			return this.readUint16()*65536 + this.readUint16();
		},
		readUint64: function () {
			return this.readUint32()*4294967296 + this.readUint32();
		}
	};
	function Writer() {
	}
	Writer.prototype = {
		writeByte: notImplemented,
		writeChunk: notImplemented,
		result: notImplemented,
		writeUint16: function (value) {
			this.writeByte(value >> 8);
			this.writeByte(value&0xff);
		},
		writeUint32: function (value) {
			this.writeUint16(value>>16);
			this.writeUint16(value&0xffff);
		},
		writeUint64: function (value) {
			this.writeUint32(Math.floor(value/4294967296));
			this.writeUint32(value%4294967296);
		}
	}
	
	function BufferReader(buffer) {
		this.buffer = buffer;
		this.pos = 0;
	}
	BufferReader.prototype = Object.create(Reader.prototype);
	BufferReader.prototype.peekByte = function () {
		return this.buffer[this.pos];
	};
	BufferReader.prototype.readByte = function () {
		return this.buffer[this.pos++];
	};
	BufferReader.prototype.readUint16 = function () {
		var result = this.buffer.readUInt16BE(this.pos);
		this.pos += 2;
		return result;
	};
	BufferReader.prototype.readUint32 = function () {
		var result = this.buffer.readUInt32BE(this.pos);
		this.pos += 4;
		return result;
	};
	BufferReader.prototype.readChunk = function (length) {
		var result = new Buffer(length);
		this.buffer.copy(result, 0, this.pos, this.pos += length);
		return result;
	};
	
	function StreamWriter() {
		this.byteLength = 0;
		this.defaultBufferLength = 16384; // 16k
		this.latestBuffer = new Buffer(this.defaultBufferLength);
		this.latestBufferOffset = 0;
		this.completeBuffers = [];
	}
	StreamWriter.prototype = Object.create(Writer.prototype);
	StreamWriter.prototype.writeByte = function (value) {
		this.latestBuffer[this.latestBufferOffset++] = value;
		if (this.latestBufferOffset >= this.latestBuffer.length) {
			this.completeBuffers.push(latestBuffer);
			this.latestBuffer = new Buffer(this.defaultBufferLength);
			this.latestBufferOffset = 0;
		}
		this.byteLength++;
	}
	StreamWriter.prototype.writeChunk = function (chunk) {
		if (!(chunk instanceof Buffer)) throw new TypeError('StreamWriter only accepts Buffers');
		if (!this.latestBufferOffset) {
			this.completeBuffers.push(chunk);
		} else if (this.latestBuffer.length - this.latestBufferOffset >= chunk.length) {
			chunk.copy(this.latestBuffer, this.latestBufferOffset);
			this.latestBufferOffset += chunk.length;
			if (this.latestBufferOffset >= this.latestBuffer.length) {
				this.completeBuffers.push(latestBuffer);
				this.latestBuffer = new Buffer(this.defaultBufferLength);
				this.latestBufferOffset = 0;
			}
		} else {
			this.completeBuffers.push(this.latestBuffer.slice(0, this.latestBufferOffset));
			this.completeBuffers.push(chunk);
			this.latestBuffer = new Buffer(this.defaultBufferLength);
			this.latestBufferOffset = 0;
		}
		this.byteLength += chunk.length;
	}
	StreamWriter.prototype.result = function () {
		// Copies them all into a single Buffer
		var result = new Buffer(this.byteLength);
		var offset = 0;
		for (var i = 0; i < this.completeBuffers.length; i++) {
			var buffer = this.completeBuffers[i];
			buffer.copy(result, offset, 0, buffer.length);
			offset += buffer.length;
		}
		if (this.latestBufferOffset) {
			this.latestBuffer.copy(result, offset, 0, this.latestBufferOffset);
		}
		return result;
	}
	
	function readHeader(reader) {
		var firstByte = reader.readByte();
		var majorType = firstByte >> 5, value = firstByte&0x1f;
		if (value < 24) {
			// cool cool cool
		} else if (value == 24) {
			value = reader.readByte();
		} else if (value == 25) {
			value = reader.readUint16();
		} else if (value == 26) {
			value = reader.readUint32();
		} else if (value == 27) {
			value = reader.readUint64();
		} else if (value == 31) {
			// special value for non-terminating arrays/objects
			value = null;
		} else {
			notImplemented();
		}
		return {type: majorType, value: value};
	}
	
	function writeHeader(type, value, writer) {
		var firstByte = type<<5;
		if (value < 24) {
			writer.writeByte(firstByte|value);
		} else if (value < 256) {
			writer.writeByte(firstByte|24);
			writer.writeByte(value);
		} else if (value < 65536) {
			writer.writeByte(firstByte|25);
			writer.writeUint16(value);
		} else if (value < 4294967296) {
			writer.writeByte(firstByte|26);
			writer.writeUint32(value);
		} else {
			writer.writeByte(firstByte|27);
			writer.writeUint64(value);
		}
	}
	
	function decodeReader(reader) {
		var header = readHeader(reader);
		switch (header.type) {
			case 0:
				return header.value;
			case 1:
				return -1 -header.value;
			default:
				notImplemented();
		}
		throw new Error('not implemented yet');
	}
	
	function encodeWriter(data, writer) {
		if (typeof data === 'number') {
			if (Math.floor(data) === data) {
				// Integer
				if (data < 0) {
					writeHeader(1, -1 - data, writer);
				} else {
					writeHeader(0, data, writer);
				}
			} else {
				notImplemented();
			}
		} else {
			notImplemented();
		}
	}
	
	var api = {
		encode: function (data) {
			var writer = new StreamWriter();
			encodeWriter(data, writer);
			return writer.result();
		},
		decode: function (buffer) {
			var reader = new BufferReader(buffer);
			return decodeReader(reader);
		},
		addSemanticEncode: function (tag, fn) {
			if (typeof tag !== 'number' || tag%1 !== 0 || tag < 0) {
				throw new Error('Tag must be a positive integer');
			}
			semanticEncoders.push({tag: tag, fn: fn});
			return this;
		},
		addSemanticDecode: function (tag, fn) {
			if (typeof tag !== 'number' || tag%1 !== 0 || tag < 0) {
				throw new Error('Tag must be a positive integer');
			}
			semanticDecoders[tag] = fn;
			return this;
		}
	};

	return api;
})();

if (typeof module !== 'undefined') {
	module.exports = CBOR;
}