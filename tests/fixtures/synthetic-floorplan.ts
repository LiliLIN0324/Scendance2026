import {deflateSync} from 'node:zlib';

/** A self-drawn, fictional 320×240 PNG; never use it as a real venue plan. */
export function syntheticFloorplanPng():Uint8Array {
  const width=320,height=240, pixels=Buffer.alloc((width*3+1)*height,255);
  for(let y=0;y<height;y++)pixels[y*(width*3+1)]=0;
  const dot=(x:number,y:number)=>{if(x<0||x>=width||y<0||y>=height)return;const i=y*(width*3+1)+1+x*3;pixels[i]=pixels[i+1]=pixels[i+2]=0;};
  for(let x=35;x<=285;x++)for(let t=0;t<3;t++){if(x<98||x>124)dot(x,30+t);if(x<135||x>174)dot(x,205+t);}
  for(let y=30;y<=207;y++)for(let t=0;t<3;t++){dot(35+t,y);dot(283+t,y);}
  // Wall gaps are illustrative, not measured door/window positions or exits.
  const glyphs:Record<string,string[]>={
    '1':['00100','01100','00100','00100','01110'],'2':['11110','00001','01110','10000','11111'],
    '0':['01110','10001','10001','10001','01110'],'m':['00000','11010','10101','10101','10101'],
  };
  const text=(word:string,x:number,y:number)=>{for(const ch of word){const g=glyphs[ch];if(g)g.forEach((row,yy)=>[...row].forEach((p,xx)=>{if(p==='1')for(let a=0;a<2;a++)for(let b=0;b<2;b++)dot(x+xx*2+a,y+yy*2+b);}));x+=12;}};
  text('12000mm',100,10);text('10000mm',100,220);
  const chunk=(type:string,data:Buffer)=>{const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length,0);b.write(type,4,4,'ascii');data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,8+data.length)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
