
import test from "node:test";
import assert from "node:assert/strict";
import {randomFillSync} from "node:crypto";
import {deflateSync} from "node:zlib";
import {encodeBatch,decodeResponse,UnsupportedInput,InvalidResponse} from "./protocol.mjs";
const batch = {
 state:"货物尚未电放，ETA 明天，需要联系起运港。",
 questions:{
  "是否紧急/urgent":{type:"boolean",instructions:"Is this urgent?",criteria:{true:"ETA within 2 days with pending release",false:"No near-term impact"}},
  route:{type:"choice",instructions:"Choose a team",criteria:{"关务/customs":"Customs clearance","海运/ocean":"Ocean freight and cargo release"}},
  severity:{type:"score",instructions:"Rate severity",criteria:["None","Moderate","Critical"]}
 }
};
const MiB = 1024 * 1024;
const pngSignature = Buffer.from("89504e470d0a1a0a","hex");
const crcTable = Uint32Array.from({length:256},(_,n) => {
 let c=n;
 for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0);
 return c>>>0;
});
function pngChunk(type,data) {
 const out=Buffer.alloc(data.length+12);
 out.writeUInt32BE(data.length,0); out.write(type,4,"ascii"); data.copy(out,8);
 let crc=0xffffffff;
 for (let i=4;i<out.length-4;i++) crc=crcTable[(crc^out[i])&255]^(crc>>>8);
 out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);
 return out;
}
function png(width,height,{targetSize,noise=false}={}) {
 const rowBytes=noise ? width*3 : Math.ceil(width/8), stride=rowBytes+1;
 const pixels=Buffer.alloc(stride*height);
 if (noise) { randomFillSync(pixels); for (let i=0;i<height;i++) pixels[i*stride]=0; }
 const header=Buffer.alloc(13);
 header.writeUInt32BE(width,0); header.writeUInt32BE(height,4);
 header[8]=noise?8:1; header[9]=noise?2:0;
 const first=[pngSignature,pngChunk("IHDR",header),pngChunk("IDAT",deflateSync(pixels))];
 const end=pngChunk("IEND",Buffer.alloc(0));
 if (targetSize !== undefined) {
  const current=first.reduce((n,b)=>n+b.length,0)+end.length;
  assert.ok(targetSize>=current+12);
  // A valid private ancillary chunk makes exact byte boundaries reproducible.
  first.push(pngChunk("caNd",Buffer.alloc(targetSize-current-12,65)));
 }
 return Buffer.concat([...first,end]);
}
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAACAAMDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==","base64");
const webp = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoDAAIAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=","base64");
const webpLossless = Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAAAcQ/Y/+ByKi/wEA","base64");
const webpExtended = Buffer.from("UklGRmIAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAAAAAAAP8AAFZQOCA0AAAA0AEAnQEqAwACAAIANCWoAnRHAGSAA1AA/vDECsfS3YM0j/x//NEUzuhMfhH/NEUzugAAAA==","base64");
const dataUrl = (type,bytes) => `data:image/${type};base64,${bytes.toString("base64")}`;
const imageBatch = state => ({state,questions:{q:{type:"boolean",instructions:"?"}}});
function response() {
 return {success:true,result:{model:"clef-flash",answers:{
  q0:{type:"noul",noul:0.97},
  q1:{type:"choice",choice:"c1",probabilities:{c0:0.08,c1:0.92},confidence:0.8},
  q2:{type:"score",score:1.7,legend:{"0":"None","1":"Moderate","2":"Critical"},probabilities:{"0":0.1,"1":0.1,"2":0.8},confidence:0.7}
 },usage:{input_tokens:410,output_tokens:0}}};
}
test("vendor System One fixture preserves probabilities, score order, unicode identifiers and usage",()=>{
 const req=encodeBatch(batch,"clef-flash");
 assert.deepEqual(Object.keys(req.payload.questions),["q0","q1","q2"]);
 assert.equal(req.payload.questions.q0.type,"noul");
 const r=decodeResponse(response(),req);
 assert.deepEqual(r.answers["是否紧急/urgent"],{type:"boolean",probabilityTrue:0.97});
 assert.equal(r.answers.route.choice,"海运/ocean");
 assert.deepEqual(r.answers.route.probabilities,{"关务/customs":0.08,"海运/ocean":0.92});
 assert.deepEqual(r.answers.severity.probabilities,[0.1,0.1,0.8]);
 assert.deepEqual(r.usage,{inputTokens:410,outputTokens:0});
});
test("reject missing probabilities, nonfinite scores and foreign choices instead of inventing certainty",()=>{
 const req=encodeBatch(batch,"clef-flash");
 for (const mutate of [
  r=>{delete r.result.answers.q0;},
  r=>{r.result.answers.q0.noul=1.1;},
  r=>{r.result.answers.q1.choice="unlisted";},
  r=>{r.result.answers.q1.probabilities.c0=0.9;},
  r=>{r.result.answers.q2.score=Infinity;},
  r=>{delete r.result.answers.q2.probabilities["1"];},
  r=>{r.result.model="other";}
 ]) { const r=response(); mutate(r); assert.throws(()=>decodeResponse(r,req),InvalidResponse); }
});
test("reject oversized evidence and unsupported score rubrics before network I/O",()=>{
 assert.throws(()=>encodeBatch({...batch,state:"x".repeat(24576)},"clef-flash"),UnsupportedInput);
 assert.throws(()=>encodeBatch({state:"x",questions:{s:{type:"score",criteria:Array(11).fill("x")}}},"clef"),UnsupportedInput);
 assert.throws(()=>encodeBatch(batch,"not-a-clef-model"),UnsupportedInput);
});
test("round-trips untrusted map keys without object prototype mutation",()=>{
 const criteria=JSON.parse('{"__proto__":"A","constructor":"B"}');
 const b={state:"x",questions:JSON.parse('{"__proto__":{"type":"choice","criteria":{"__proto__":"A","constructor":"B"}}}')};
 const req=encodeBatch(b,"clef-flash");
 const r=decodeResponse({model:"clef-flash",answers:{q0:{type:"choice",choice:"c0",probabilities:{c0:0.8,c1:0.2}}}},req);
 assert.equal(r.answers["__proto__"].choice,"__proto__");
 assert.equal(Object.getPrototypeOf(r.answers),null);
 assert.equal(Object.prototype.polluted,undefined);
});

test("extracts real PNG, JPEG and WebP images and preserves text and metadata",()=>{
 const pngUrl=dataUrl("png",png(2,2)), webpUrl=dataUrl("webp",webp);
 const input={state:{caption:`Compare ${pngUrl} with ${webpUrl}.`,
   photo:{content_type:"image/jpeg",base64:jpeg.toString("base64"),shipment_id:"GN42",description:"front"},
   text:{content_type:"text/plain",base64:"SGVsbG8=",description:"retain"}},
  questions:{q:{type:"boolean",instructions:"Do they match?"}}};
 const req=encodeBatch(input,"clef-flash");
 assert.deepEqual(Object.keys(req.payload),["model","images","state","questions"]);
 assert.deepEqual(req.payload.images,[pngUrl,webpUrl,{content_type:"image/jpeg",base64:jpeg.toString("base64")}]);
 assert.equal(req.payload.state.caption,"Compare [image #1] with [image #2].");
 assert.equal(req.payload.state.photo.base64,"[image #3]");
 assert.equal(req.payload.state.photo.shipment_id,"GN42");
 assert.equal(req.payload.state.photo.description,"front");
 assert.equal(req.payload.state.photo.content_type,"image/jpeg");
 assert.equal(req.payload.state.text.content_type,"text/plain");
 assert.equal(req.payload.state.text.base64,"SGVsbG8=");
 const plain=encodeBatch(imageBatch("data:text/plain;base64,SGVsbG8="),"clef-flash");
 assert.equal("images" in plain.payload,false);
 assert.equal(plain.payload.state,"data:text/plain;base64,SGVsbG8=");
});

test("normalizes line-wrapped standalone Base64 and preserves surrounding prose",()=>{
 const image=png(2,2), canonical=dataUrl("png",image);
 const folded=image.toString("base64").match(/.{1,24}/g).join("\r\n");
 const req=encodeBatch(imageBatch(`  data:image/png;base64,${folded}  `),"clef");
 assert.equal(req.payload.state,"  [image #1]  ");
 assert.deepEqual(req.payload.images,[canonical]);
 const trailing=encodeBatch(imageBatch(`${dataUrl("jpeg",jpeg)} and keep this text`),"clef");
 assert.equal(trailing.payload.state,"[image #1] and keep this text");
});

test("passes an actual 2 MiB PNG without counting its Base64 as text",()=>{
 const image=png(900,800,{noise:true});
 assert.ok(image.length>2*MiB && image.length<4*MiB);
 const req=encodeBatch(imageBatch(dataUrl("png",image)),"clef-flash");
 assert.equal(req.payload.images.length,1);
 assert.equal(req.payload.state,"[image #1]");
 assert.ok(Buffer.byteLength(req.body)>2*MiB);
});

test("allows four images and rejects the fifth before sending",()=>{
 const image=dataUrl("png",png(1,1));
 assert.equal(encodeBatch(imageBatch(Array(4).fill(image)),"clef").payload.images.length,4);
 assert.throws(()=>encodeBatch(imageBatch(Array(5).fill(image)),"clef"),/at most 4 images/);
});

test("enforces individual and aggregate decoded byte limits",()=>{
 const tiny=png(1,1), max=png(1,1,{targetSize:4*MiB});
 const oversized=png(1,1,{targetSize:4*MiB+1});
 const underMax=png(1,1,{targetSize:4*MiB-tiny.length+1});
 const maxUrl=dataUrl("png",max);
 assert.equal(encodeBatch(imageBatch(maxUrl),"clef").payload.images.length,1);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("png",oversized)),"clef"),/4 MiB/);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("png",Buffer.alloc(4*MiB+2))),"clef"),/4 MiB/);
 const total=encodeBatch(imageBatch([maxUrl,maxUrl]),"clef");
 assert.equal(total.payload.images.length,2);
 assert.ok(Buffer.byteLength(total.body)<=13*MiB);
 assert.throws(()=>encodeBatch(imageBatch([maxUrl,dataUrl("png",underMax),dataUrl("png",tiny)]),"clef"),/8 MiB/);
 assert.throws(()=>encodeBatch(imageBatch("x".repeat(13*MiB+1)),"clef"),/context budget/);
});

test("enforces 16 megapixels for PNG, JPEG and extended WebP",()=>{
 assert.equal(encodeBatch(imageBatch(dataUrl("png",png(4000,4000))),"clef").payload.images.length,1);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("png",png(4001,4000))),"clef"),/16 megapixel/);
 const jpegTooLarge=Buffer.from(jpeg), sof=jpegTooLarge.indexOf(Buffer.from([0xff,0xc0]));
 assert.ok(sof>=0); jpegTooLarge.writeUInt16BE(4000,sof+5); jpegTooLarge.writeUInt16BE(4001,sof+7);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("jpeg",jpegTooLarge)),"clef"),/16 megapixel/);
 const webpTooLarge=Buffer.from(webpExtended), vp8x=webpTooLarge.indexOf("VP8X");
 assert.ok(vp8x>=0); webpTooLarge.writeUIntLE(4000,vp8x+12,3); webpTooLarge.writeUIntLE(3999,vp8x+15,3);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("webp",webpTooLarge)),"clef"),/16 megapixel/);
 const frameTooLarge=Buffer.from(webpExtended), frame=frameTooLarge.indexOf("VP8 ");
 assert.ok(frame>=0); frameTooLarge.writeUInt16LE(5000,frame+14); frameTooLarge.writeUInt16LE(4000,frame+16);
 assert.throws(()=>encodeBatch(imageBatch(dataUrl("webp",frameTooLarge)),"clef"),/16 megapixel/);
 for (const image of [webp,webpLossless,webpExtended])
  assert.equal(encodeBatch(imageBatch(dataUrl("webp",image)),"clef").payload.images.length,1);
});

test("rejects malformed Base64, unsupported image types and mismatched or incomplete files",()=>{
 for (const image of [
  "data:image/png;base64,====",
  "data:image/png;base64,AB==",
  "data:image/gif;base64,R0lGODlh",
  dataUrl("png",jpeg),
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  {content_type:"image/jpeg",base64:"Zm9v"},
  {content_type:"image/png",base64:"https://example.com/image.png"}
 ]) assert.throws(()=>encodeBatch(imageBatch(image),"clef"),UnsupportedInput);
 const unpadded=jpeg.toString("base64").replace(/=+$/,"");
 const req=encodeBatch(imageBatch({content_type:"image/jpeg",base64:unpadded}),"clef");
 assert.equal(req.payload.images[0].base64,jpeg.toString("base64"));
 assert.equal(encodeBatch(imageBatch("https://example.com/image.png"),"clef").payload.state,"https://example.com/image.png");
});

test("rejects truncated image containers as unsupported input",()=>{
 for (const [type,image] of [["png",png(2,2)],["jpeg",jpeg],["webp",webpExtended]]) {
  for (let length=0;length<image.length;length++) {
   assert.throws(()=>encodeBatch(imageBatch(dataUrl(type,image.subarray(0,length))),"clef"),UnsupportedInput);
  }
 }
});

test("extracts only sent fields and keeps state and question references in array order",()=>{
 const a=dataUrl("png",png(1,1)), b=dataUrl("webp",webp), c=dataUrl("jpeg",jpeg);
 const input={state:`State ${a} end`,questions:{q:{type:"choice",instructions:`Inspect ${b}!`,
  criteria:{yes:`Shown in ${c}`,no:"No"},metadata:{unused:Array(5).fill(a)}}}};
 const req=encodeBatch(input,"clef");
 assert.deepEqual(req.payload.images,[a,b,c]);
 assert.equal(req.payload.state,"State [image #1] end");
 assert.equal(req.payload.questions.q0.instructions,"Inspect [image #2]!");
 assert.equal(req.payload.questions.q0.criteria.c0.description,"Shown in [image #3]");
 assert.equal("metadata" in req.payload.questions.q0,false);
});

test("extracts image choice labels while returning the original choice key",()=>{
 const image=dataUrl("png",png(1,1));
 const input={state:"Choose a picture",questions:{q:{type:"choice",instructions:"Choose",criteria:{[image]:"picture",none:"no picture"}}}};
 const req=encodeBatch(input,"clef");
 assert.deepEqual(req.payload.images,[image]);
 assert.equal(req.payload.questions.q0.criteria.c0.label,"[image #1]");
 const result=decodeResponse({model:"clef",answers:{q0:{type:"choice",choice:"c0",probabilities:{c0:0.9,c1:0.1}}}},req);
 assert.equal(result.answers.q.choice,image);
 assert.equal(result.answers.q.probabilities[image],0.9);
});

test("reserves image tokens in the text context and checks encoding deadlines",()=>{
 const image=dataUrl("png",png(1,1));
 assert.doesNotThrow(()=>encodeBatch(imageBatch("x".repeat(21000)),"clef-flash"));
 assert.throws(()=>encodeBatch(imageBatch({text:"x".repeat(21000),images:Array(4).fill(image)}),"clef-flash"),/context budget/);
 let checks=0;
 assert.throws(()=>encodeBatch(imageBatch(image),"clef",()=>{if (++checks===3) throw new Error("deadline");}),/deadline/);
});
