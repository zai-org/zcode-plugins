
/** SDK-free translation of OpenClaw's decision contract to CLEF's System One API. */
export class UnsupportedInput extends Error {}
export class InvalidResponse extends Error {}
const own = (o,k) => Object.hasOwn(o,k);
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const probability = x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
const fail = () => { throw new InvalidResponse("Invalid CLEF decision response"); };
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_BODY_BYTES = 13 * 1024 * 1024;
const CONTEXT_BUDGET = 24_000;
const MAX_IMAGE_TOKENS = 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const invalidImage = () => { throw new UnsupportedInput("Invalid or unsupported image data"); };
const validateDimensions = (width,height) => {
  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw new UnsupportedInput("Image exceeds CLEF's 16 megapixel limit or has invalid dimensions");
};

// Inspect container headers without expanding pixel data. This bounds memory and
// checks the documented pixel limit; the service still performs full decoding.
function imageDimensions(bytes, contentType) {
  let width, height;
  if (contentType === "image/png") {
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    if (bytes.length < 33 || !bytes.subarray(0,8).equals(signature) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii",12,16) !== "IHDR") invalidImage();
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
    validateDimensions(width,height);
    let offset = 8, sawData = false, sawEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) invalidImage();
      const type = bytes.toString("ascii",offset + 4,offset + 8);
      if (offset !== 8 && type === "IHDR") invalidImage();
      if (type === "IDAT") sawData = true;
      if (type === "IEND") {
        if (length !== 0 || !sawData || offset + 12 !== bytes.length) invalidImage();
        sawEnd = true; break;
      }
      offset += length + 12;
    }
    if (!sawEnd) invalidImage();
  } else if (contentType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalidImage();
    let offset = 2, sawScan = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalidImage();
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) invalidImage();
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0x00 || marker === 0xd8) invalidImage();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) invalidImage();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || length > bytes.length - offset) invalidImage();
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) invalidImage();
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
        validateDimensions(width,height);
      }
      if (marker === 0xda) {
        if (width === undefined || bytes.lastIndexOf(Buffer.from([0xff,0xd9])) < offset + length) invalidImage();
        sawScan = true; break;
      }
      offset += length;
    }
    if (!sawScan) invalidImage();
  } else if (contentType === "image/webp") {
    if (bytes.length < 20 || bytes.toString("ascii",0,4) !== "RIFF" ||
        bytes.toString("ascii",8,12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) invalidImage();
    let offset = 12, sawImage = false, canvas;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString("ascii",offset,offset + 4), length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (length > bytes.length - start || start + length + (length & 1) > bytes.length) invalidImage();
      if (type === "VP8X") {
        if (length !== 10) invalidImage();
        canvas = [bytes.readUIntLE(start + 4,3) + 1, bytes.readUIntLE(start + 7,3) + 1];
        validateDimensions(...canvas);
      } else if (type === "VP8 ") {
        if (length < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) invalidImage();
        width = bytes.readUInt16LE(start + 6) & 0x3fff; height = bytes.readUInt16LE(start + 8) & 0x3fff;
        validateDimensions(width,height);
        sawImage = true;
      } else if (type === "VP8L") {
        if (length < 5 || bytes[start] !== 0x2f) invalidImage();
        const bits = bytes.readUInt32LE(start + 1);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        validateDimensions(width,height);
        sawImage = true;
      } else if (type === "ANMF") {
        if (length < 16) invalidImage();
        validateDimensions(bytes.readUIntLE(start + 6,3) + 1,bytes.readUIntLE(start + 9,3) + 1);
        sawImage = true;
      }
      offset = start + length + (length & 1);
    }
    if (offset !== bytes.length || !sawImage) invalidImage();
    if (canvas) [width,height] = canvas;
  } else invalidImage();
  validateDimensions(width,height);
  return {width,height};
}

function decodeImageBase64(value, totalBytes) {
  // Reject excessive encodings before copying or allocating their decoded bytes.
  if (value.length > MAX_BODY_BYTES) throw new UnsupportedInput("Image exceeds CLEF's 4 MiB limit");
  const encoded = value.replace(/[\t\r\n ]/g, "");
  if (encoded.length > MAX_BASE64_LENGTH) throw new UnsupportedInput("Image exceeds CLEF's 4 MiB limit");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) invalidImage();
  const pad = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const chars = encoded.length - pad, remainder = chars % 4;
  if (remainder === 1 || (pad && (encoded.length % 4 !== 0 || pad !== 4 - remainder))) invalidImage();
  const last = BASE64_ALPHABET.indexOf(encoded[chars - 1]);
  if ((remainder === 2 && (last & 15)) || (remainder === 3 && (last & 3))) invalidImage();
  const size = Math.floor(chars * 3 / 4);
  if (size > MAX_IMAGE_BYTES) throw new UnsupportedInput("Image exceeds CLEF's 4 MiB limit");
  if (totalBytes + size > MAX_TOTAL_IMAGE_BYTES) throw new UnsupportedInput("Images exceed CLEF's 8 MiB total limit");
  const canonical = pad ? encoded : encoded + "=".repeat((4 - remainder) % 4);
  const bytes = Buffer.from(canonical, "base64");
  if (bytes.length !== size) invalidImage();
  return {canonical,bytes};
}

export function encodeBatch(batch, model, checkpoint = () => {}) {
  checkpoint();
  if (!["clef","clef-flash"].includes(model) || !object(batch) || !object(batch.questions))
    throw new UnsupportedInput("Unsupported model or questions");
  const entries = Object.entries(batch.questions);
  if (!entries.length || entries.length > 64) throw new UnsupportedInput("CLEF accepts 1–64 questions");
  // Images are transported separately from text, with 1-based references in
  // the original context. Traverse only fields actually sent to CLEF.
  const images = [];
  let totalImageBytes = 0, textBytes = 0;
  const accountText = value => {
    textBytes += Buffer.byteLength(value,"utf8");
    if (textBytes > CONTEXT_BUDGET)
      throw new UnsupportedInput("Evidence exceeds this adapter's conservative context budget");
    return value;
  };
  const addImage = (contentType, encoded, asObject, requireExactEnd = false) => {
    checkpoint();
    contentType = contentType.toLowerCase();
    if (!["image/png","image/jpeg","image/webp"].includes(contentType)) invalidImage();
    if (images.length >= MAX_IMAGES) throw new UnsupportedInput("CLEF accepts at most 4 images");
    const {canonical,bytes} = decodeImageBase64(encoded,totalImageBytes);
    checkpoint();
    imageDimensions(bytes,contentType);
    // Only use the whitespace-folded interpretation when it consumes the
    // complete JPEG; otherwise trailing prose could be mistaken for Base64.
    if (requireExactEnd && contentType === "image/jpeg" &&
        (bytes[bytes.length-2] !== 0xff || bytes[bytes.length-1] !== 0xd9)) invalidImage();
    totalImageBytes += bytes.length;
    images.push(asObject ? {content_type:contentType,base64:canonical} : `data:${contentType};base64,${canonical}`);
    return `[image #${images.length}]`;
  };
  const transform = (x) => {
    checkpoint();
    if (typeof x === "string") {
      if (x.length > MAX_BODY_BYTES + CONTEXT_BUDGET)
        throw new UnsupportedInput("Evidence exceeds CLEF's size limits");
      // Preserve the previously supported standalone, line-wrapped Base64
      // form, while retaining prose that follows a complete data URL.
      const start = x.search(/\S/), end = x.trimEnd().length;
      const whole = start < 0 ? null : /^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(x.slice(start,end));
      if (whole && /\s/.test(whole[2])) {
        let reference;
        try { reference = addImage("image/" + whole[1],whole[2],false,true); }
        catch (e) { if (!(e instanceof UnsupportedInput)) throw e; }
        if (reference !== undefined) return accountText(x.slice(0,start) + reference + x.slice(end));
      }
      const prefix = /data:image\/([A-Za-z0-9.+-]+);base64,/gi;
      let match, cursor = 0, result = "";
      while ((match = prefix.exec(x)) !== null) {
        const data = /^[A-Za-z0-9+/=]+/.exec(x.slice(prefix.lastIndex,prefix.lastIndex + MAX_BASE64_LENGTH + 1));
        if (!data) invalidImage();
        result += x.slice(cursor,match.index) + addImage("image/" + match[1],data[0],false);
        cursor = prefix.lastIndex + data[0].length;
        prefix.lastIndex = cursor;
      }
      return accountText(cursor ? result + x.slice(cursor) : x);
    }
    if (Array.isArray(x)) {
      if (x.length > CONTEXT_BUDGET / 2) throw new UnsupportedInput("Evidence exceeds this adapter's conservative context budget");
      return x.map(transform);
    }
    if (x !== null && typeof x === "object") {
      const keys = Object.keys(x);
      if (keys.length > CONTEXT_BUDGET / 4) throw new UnsupportedInput("Evidence exceeds this adapter's conservative context budget");
      if (own(x,"content_type") && own(x,"base64") &&
          typeof x.content_type === "string" && /^image\//i.test(x.content_type)) {
        if (typeof x.base64 !== "string") invalidImage();
        const reference = addImage(x.content_type,x.base64,true);
        if (keys.length === 2) return accountText(reference);
        const o = Object.create(null);
        for (const k of keys) { accountText(k); o[k] = k === "base64" ? accountText(reference) : transform(x[k]); }
        return o;
      }
      const o = Object.create(null);
      for (const k of keys) { accountText(k); o[k] = transform(x[k]); }
      return o;
    }
    return x;
  };
  // State images precede question images in the array; all placeholders use the
  // same order. JSON member order is not required by the CLEF API.
  const state = transform(batch.state);
  const questions = Object.create(null), mapping = [];
  let alternatives = 0;
  for (const [id,qRaw] of entries) {
    checkpoint();
    if (!object(qRaw)) throw new UnsupportedInput("Unsupported question type");
    const q = {type:qRaw.type};
    const wireId = "q" + mapping.length;
    const instructions = transform(qRaw.instructions ?? (
      q.type === "boolean" ? "Does the supplied state satisfy the true criterion rather than the false criterion?" :
      q.type === "choice" ? "Choose the best matching criterion for the supplied state." :
      "Rate the supplied state on the ordered criteria from lowest to highest."
    ));
    if (q.type === "boolean") {
      if (qRaw.criteria) q.criteria = transform(qRaw.criteria);
      questions[wireId] = {type:"noul", instructions, ...(q.criteria ? {criteria:q.criteria}: {})};
      mapping.push({id,wireId,q}); alternatives += 2;
    } else if (q.type === "choice") {
      const keys = Object.keys(qRaw.criteria ?? {});
      if (keys.length < 2 || keys.length > 255) throw new UnsupportedInput("CLEF accepts 2–255 choices");
      const criteria = Object.create(null);
      keys.forEach((key,i) => { criteria["c"+i] = {label:transform(key), description:transform(qRaw.criteria[key])}; });
      questions[wireId] = {type:"choice",instructions,criteria};
      mapping.push({id,wireId,q,keys}); alternatives += keys.length;
    } else if (q.type === "score") {
      if (!Array.isArray(qRaw.criteria) || qRaw.criteria.length < 2 || qRaw.criteria.length > 10 || qRaw.criteria.some(v=>v===null))
        throw new UnsupportedInput("CLEF accepts 2–10 non-null score criteria");
      q.criteria = transform(qRaw.criteria);
      questions[wireId] = {type:"score",instructions,criteria:q.criteria};
      mapping.push({id,wireId,q}); alternatives += q.criteria.length;
    } else throw new UnsupportedInput("Unsupported question type");
  }
  const textPayload = {model,state,questions};
  // Binary images are visual tokens, not the Base64 characters used on the wire.
  // Reserve Cloudflare's documented upper bound of 1,024 tokens per image.
  if (Buffer.byteLength(JSON.stringify(textPayload),"utf8") + 1024 + 128*alternatives + MAX_IMAGE_TOKENS*images.length > CONTEXT_BUDGET)
    throw new UnsupportedInput("Evidence exceeds this adapter's conservative context budget");
  const payload = {model,...(images.length ? {images}: {}),state,questions};
  checkpoint();
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body,"utf8") > MAX_BODY_BYTES)
    throw new UnsupportedInput("Request exceeds CLEF's 13 MiB body limit");
  checkpoint();
  return {payload,body,mapping};
}
export function decodeResponse(envelope, request) {
  if (!object(envelope) || envelope.success === false) return fail();
  const raw = own(envelope,"result") ? envelope.result : envelope;
  if (!object(raw) || typeof raw.model !== "string" || raw.model !== request.payload.model ||
      !object(raw.answers) || Object.keys(raw.answers).length !== request.mapping.length) return fail();
  const answers = Object.create(null);
  for (const {id,wireId,q,keys} of request.mapping) {
    if (!own(raw.answers,wireId)) return fail();
    const a = raw.answers[wireId];
    if (!object(a)) return fail();
    if (q.type === "boolean") {
      if (a.type !== "noul" || !probability(a.noul)) return fail();
      answers[id] = {type:"boolean",probabilityTrue:a.noul};
    } else {
      if (a.type !== q.type || !object(a.probabilities)) return fail();
      const expected = q.type === "choice" ? keys.map((_,i)=>"c"+i) : q.criteria.map((_,i)=>String(i));
      if (Object.keys(a.probabilities).length !== expected.length ||
          expected.some(k=>!own(a.probabilities,k) || !probability(a.probabilities[k]))) return fail();
      const p = expected.map(k=>a.probabilities[k]);
      if (Math.abs(p.reduce((s,v)=>s+v,0)-1) > 0.03) return fail();
      if (a.confidence !== undefined && !probability(a.confidence)) return fail();
      const confidence = a.confidence === undefined ? {} : {confidence:a.confidence};
      if (q.type === "choice") {
        const index = expected.indexOf(a.choice);
        if (index < 0) return fail();
        answers[id] = {type:"choice",choice:keys[index],probabilities:Object.fromEntries(keys.map((k,i)=>[k,p[i]])),...confidence};
      } else {
        if (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > q.criteria.length-1) return fail();
        answers[id] = {type:"score",score:a.score,probabilities:p,...confidence};
      }
    }
  }
  const result = {model:raw.model,answers};
  if (raw.usage !== undefined) {
    if (!object(raw.usage)) return fail();
    const usage = {};
    for (const [wire,key] of [["input_tokens","inputTokens"],["output_tokens","outputTokens"]]) {
      const value = raw.usage[wire];
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 0) return fail();
        usage[key] = value;
      }
    }
    result.usage = usage;
  }
  return result;
}
