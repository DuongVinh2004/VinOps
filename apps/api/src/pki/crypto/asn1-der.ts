export const ASN1_TAGS = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

export type Asn1Node = {
  tag: number;
  headerLength: number;
  length: number;
  totalLength: number;
  raw: Buffer;
  value: Buffer;
  children?: Asn1Node[] | undefined;
};

export function parseDer(buffer: Buffer, offset = 0): Asn1Node {
  if (offset >= buffer.length) {
    throw new Error(`ASN.1 parser error: offset ${offset} beyond buffer length ${buffer.length}`);
  }

  const startOffset = offset;
  let current = offset;

  // 1. Tag
  let tag = buffer[current]!;
  current += 1;
  if ((tag & 0x1f) === 0x1f) {
    // High tag number form (multi-byte tag)
    let tagVal = 0;
    while (current < buffer.length) {
      const byte = buffer[current]!;
      current += 1;
      tagVal = (tagVal << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    tag = tagVal;
  }

  // 2. Length
  if (current >= buffer.length) {
    throw new Error('ASN.1 parser error: truncated length byte');
  }

  const firstLenByte = buffer[current]!;
  current += 1;
  let length: number;

  if ((firstLenByte & 0x80) === 0) {
    // Short form (0..127)
    length = firstLenByte;
  } else {
    // Long form
    const numOctets = firstLenByte & 0x7f;
    if (numOctets === 0) {
      throw new Error('ASN.1 parser error: indefinite length not supported in DER');
    }
    if (current + numOctets > buffer.length) {
      throw new Error('ASN.1 parser error: truncated long-form length');
    }
    let len = 0;
    for (let i = 0; i < numOctets; i++) {
      len = (len << 8) | buffer[current]!;
      current += 1;
    }
    length = len;
  }

  const headerLength = current - startOffset;
  const totalLength = headerLength + length;

  if (startOffset + totalLength > buffer.length) {
    throw new Error(
      `ASN.1 parser error: node requires ${totalLength} bytes but only ${buffer.length - startOffset} available`,
    );
  }

  const raw = buffer.subarray(startOffset, startOffset + totalLength);
  const value = buffer.subarray(current, current + length);

  const isConstructed = (tag & 0x20) !== 0 || tag === ASN1_TAGS.SEQUENCE || tag === ASN1_TAGS.SET;
  let children: Asn1Node[] | undefined;

  if (isConstructed) {
    children = [];
    let childOffset = 0;
    while (childOffset < value.length) {
      const child = parseDer(value, childOffset);
      children.push(child);
      childOffset += child.totalLength;
    }
  }

  return {
    tag,
    headerLength,
    length,
    totalLength,
    raw,
    value,
    children,
  };
}

export function parseOid(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  const firstByte = buffer[0]!;
  const first = Math.floor(firstByte / 40);
  const second = firstByte % 40;
  const arcs: number[] = [first, second];

  let currentArc = 0;
  for (let i = 1; i < buffer.length; i++) {
    const byte = buffer[i]!;
    currentArc = (currentArc << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      arcs.push(currentArc);
      currentArc = 0;
    }
  }

  return arcs.join('.');
}

export function parseInteger(buffer: Buffer): bigint {
  if (buffer.length === 0) return 0n;
  const hex = buffer.toString('hex');
  const isNegative = (buffer[0]! & 0x80) !== 0;
  if (!isNegative) {
    return BigInt(`0x${hex}`);
  }
  // Two's complement negative
  let val = 0n;
  for (const byte of buffer) {
    val = (val << 8n) | BigInt(byte);
  }
  const bits = BigInt(buffer.length * 8);
  return val - (1n << bits);
}

export function parseGeneralizedTime(buffer: Buffer): Date {
  const str = buffer.toString('ascii').trim();
  // Format: YYYYMMDDHHMMSS[.fff]Z
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/u.exec(str);
  if (!match) {
    throw new Error(`Invalid GeneralizedTime format: ${str}`);
  }
  const [, year, month, day, hour, min, sec, millis] = match;
  const ms = millis ? parseInt(millis.padEnd(3, '0').slice(0, 3), 10) : 0;
  return new Date(
    Date.UTC(
      parseInt(year!, 10),
      parseInt(month!, 10) - 1,
      parseInt(day!, 10),
      parseInt(hour!, 10),
      parseInt(min!, 10),
      parseInt(sec!, 10),
      ms,
    ),
  );
}

export function parseUtcTime(buffer: Buffer): Date {
  const str = buffer.toString('ascii').trim();
  // Format: YYMMDDHHMMSSZ
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/u.exec(str);
  if (!match) {
    throw new Error(`Invalid UTCTime format: ${str}`);
  }
  const [, yy, month, day, hour, min, sec] = match;
  let year = parseInt(yy!, 10);
  year += year >= 50 ? 1900 : 2000;
  return new Date(
    Date.UTC(
      year,
      parseInt(month!, 10) - 1,
      parseInt(day!, 10),
      parseInt(hour!, 10),
      parseInt(min!, 10),
      parseInt(sec!, 10),
    ),
  );
}

export function encodeLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len <= 0xff) {
    return Buffer.from([0x81, len]);
  }
  if (len <= 0xffff) {
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }
  if (len <= 0xffffff) {
    return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.from([0x84, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function derSequence(children: Buffer[]): Buffer {
  const content = Buffer.concat(children);
  return Buffer.concat([Buffer.from([ASN1_TAGS.SEQUENCE]), encodeLength(content.length), content]);
}

export function derSet(children: Buffer[], sort = true): Buffer {
  const items = sort ? [...children].sort((a, b) => Buffer.compare(a, b)) : children;
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([ASN1_TAGS.SET]), encodeLength(content.length), content]);
}

export function derTagged(tagNum: number, content: Buffer, constructed = true): Buffer {
  const tagByte = (constructed ? 0x20 : 0x00) | 0x80 | (tagNum & 0x1f);
  return Buffer.concat([Buffer.from([tagByte]), encodeLength(content.length), content]);
}

export function derOid(oidStr: string): Buffer {
  const arcs = oidStr.split('.').map((s) => parseInt(s, 10));
  if (arcs.length < 2) {
    throw new Error(`Invalid OID string: ${oidStr}`);
  }
  const bytes: number[] = [arcs[0]! * 40 + arcs[1]!];

  for (let i = 2; i < arcs.length; i++) {
    let arc = arcs[i]!;
    if (arc === 0) {
      bytes.push(0);
      continue;
    }
    const arcBytes: number[] = [];
    while (arc > 0) {
      arcBytes.unshift(arc & 0x7f);
      arc >>= 7;
    }
    for (let j = 0; j < arcBytes.length - 1; j++) {
      arcBytes[j]! |= 0x80;
    }
    bytes.push(...arcBytes);
  }

  const content = Buffer.from(bytes);
  return Buffer.concat([Buffer.from([ASN1_TAGS.OID]), encodeLength(content.length), content]);
}

export function derInteger(val: bigint | number | Buffer): Buffer {
  let buf: Buffer;
  if (Buffer.isBuffer(val)) {
    buf = val;
  } else {
    const bigintVal = typeof val === 'number' ? BigInt(val) : val;
    if (bigintVal === 0n) {
      buf = Buffer.from([0x00]);
    } else {
      const hex = bigintVal.toString(16);
      const padded = hex.length % 2 === 0 ? hex : '0' + hex;
      buf = Buffer.from(padded, 'hex');
      if (bigintVal > 0n && (buf[0]! & 0x80) !== 0) {
        buf = Buffer.concat([Buffer.from([0x00]), buf]);
      }
    }
  }

  return Buffer.concat([Buffer.from([ASN1_TAGS.INTEGER]), encodeLength(buf.length), buf]);
}

export function derOctetString(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([ASN1_TAGS.OCTET_STRING]), encodeLength(data.length), data]);
}

export function derBitString(data: Buffer, unusedBits = 0): Buffer {
  const content = Buffer.concat([Buffer.from([unusedBits]), data]);
  return Buffer.concat([
    Buffer.from([ASN1_TAGS.BIT_STRING]),
    encodeLength(content.length),
    content,
  ]);
}

export function derNull(): Buffer {
  return Buffer.from([ASN1_TAGS.NULL, 0x00]);
}

export function derBoolean(val: boolean): Buffer {
  return Buffer.from([ASN1_TAGS.BOOLEAN, 0x01, val ? 0xff : 0x00]);
}

export function derGeneralizedTime(date: Date): Buffer {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const sec = pad(date.getUTCSeconds());
  const str = `${year}${month}${day}${hour}${min}${sec}Z`;
  const content = Buffer.from(str, 'ascii');
  return Buffer.concat([
    Buffer.from([ASN1_TAGS.GENERALIZED_TIME]),
    encodeLength(content.length),
    content,
  ]);
}

export function derUtcTime(date: Date): Buffer {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const sec = pad(date.getUTCSeconds());
  const str = `${year}${month}${day}${hour}${min}${sec}Z`;
  const content = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([ASN1_TAGS.UTC_TIME]), encodeLength(content.length), content]);
}

export function derUtf8String(str: string): Buffer {
  const content = Buffer.from(str, 'utf8');
  return Buffer.concat([
    Buffer.from([ASN1_TAGS.UTF8_STRING]),
    encodeLength(content.length),
    content,
  ]);
}
