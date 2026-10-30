/** A rectangle in original image pixels, with an immutable capture beside the review file. */
export interface ImageRegion {
  side: 'old'|'new';
  x: number; y: number; width: number; height: number;
  imageWidth: number; imageHeight: number;
  /** Fingerprint of the diff that supplied the image; changed images must not inherit old marks. */
  source: string;
  capture: string;
}

export function imageRegion(value: any): ImageRegion|null {
  if(!value||(value.side!=='old'&&value.side!=='new')) return null;
  const {side,x,y,width,height,imageWidth,imageHeight,source,capture}=value;
  if(![x,y,width,height,imageWidth,imageHeight].every(Number.isSafeInteger)||
    x<0||y<0||width<1||height<1||imageWidth<1||imageHeight<1||
    x+width>imageWidth||y+height>imageHeight||
    typeof source!=='string'||!/^[a-z0-9]+$/i.test(source)||
    typeof capture!=='string'||!/^images\/[a-z0-9][a-z0-9._-]*\.png$/i.test(capture)) return null;
  return {side,x,y,width,height,imageWidth,imageHeight,source,capture};
}

export const regionLabel=(r: ImageRegion)=>
  (r.side==='old'?'before':'after')+' · '+r.x+','+r.y+' · '+r.width+'×'+r.height;

/** Human-readable coordinates and a normal relative image link, so agents can inspect the capture. */
export function imageRegionLines(r: ImageRegion): string[] {
  return ['<!-- lcr:image '+JSON.stringify(r)+' -->','',
    'Screenshot region on the **'+(r.side==='old'?'before':'after')+'** image: '+
    'x='+r.x+', y='+r.y+', width='+r.width+', height='+r.height+
    ' pixels (from the top-left of the '+r.imageWidth+'×'+r.imageHeight+' image).','',
    '![Selected screenshot region]('+r.capture+')',''];
}

/** Map a drag on a scaled image to original pixels. A click picks a small area around the point. */
export function regionRect(a: {x: number;y: number},b: {x: number;y: number},
  view: {width: number;height: number},size: {width: number;height: number}){
  const clamp=(n: number,max: number)=>Math.max(0,Math.min(n,Math.max(0,max)));
  const ax=clamp(a.x/view.width*size.width,size.width), ay=clamp(a.y/view.height*size.height,size.height);
  const bx=clamp(b.x/view.width*size.width,size.width), by=clamp(b.y/view.height*size.height,size.height);
  const point=Math.abs(a.x-b.x)<4&&Math.abs(a.y-b.y)<4;
  const x=Math.min(size.width-1,Math.floor(point?clamp(ax-48,size.width-96):Math.min(ax,bx)));
  const y=Math.min(size.height-1,Math.floor(point?clamp(ay-48,size.height-96):Math.min(ay,by)));
  return {x,y,width:Math.max(1,Math.min(size.width-x,point?96:Math.ceil(Math.max(ax,bx))-x)),
    height:Math.max(1,Math.min(size.height-y,point?96:Math.ceil(Math.max(ay,by))-y))};
}
