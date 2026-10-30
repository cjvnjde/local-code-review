import { describe, expect, test } from 'bun:test';
import { imageRegion, imageRegionLines, regionRect } from './image-region.ts';
import { applyComment, noteFromComment, parseReview } from './thread.ts';
import { renderMarkdown } from './review.ts';

const region={side:'new' as const,x:100,y:4200,width:300,height:120,
  imageWidth:1366,imageHeight:6814,source:'abc123',capture:'images/012345.png'};
const comment={id:'screen.png|*|*|#area1',file:'screen.png',scope:'file' as const,
  start:0,end:0,body:'This spacing is too large.',image:region};

describe('screenshot region coordinates',()=>{
  test('scales a reversed drag on a long image back into source pixels',()=>{
    expect(regionRect({x:300,y:2300},{x:100,y:2100},{width:683,height:3407},{width:1366,height:6814}))
      .toEqual({x:200,y:4200,width:400,height:400});
  });
  test('clamps a drag outside the image and keeps edge selections nonempty',()=>{
    expect(regionRect({x:-5,y:-5},{x:800,y:4000},{width:683,height:3407},{width:1366,height:6814}))
      .toEqual({x:0,y:0,width:1366,height:6814});
    expect(regionRect({x:683,y:3407},{x:900,y:3500},{width:683,height:3407},{width:1366,height:6814}))
      .toEqual({x:1365,y:6813,width:1,height:1});
  });
  test('a click picks a bounded area, including images smaller than the default capture',()=>{
    expect(regionRect({x:2,y:2},{x:2,y:2},{width:100,height:100},{width:200,height:200}))
      .toEqual({x:0,y:0,width:96,height:96});
    expect(regionRect({x:20,y:10},{x:20,y:10},{width:32,height:16},{width:32,height:16}))
      .toEqual({x:0,y:0,width:32,height:16});
  });
  test('rejects malformed coordinates, unsafe capture links and metadata strings',()=>{
    for(const over of [{side:'other'},{x:-1},{width:0},{x:1360},{y:NaN},{height:1.5},
      {capture:'images/../outside.png'},{capture:'https://example.com/image.png'},{source:'<script>'}])
      expect(imageRegion({...region,...over})).toBeNull();
  });
});

describe('screenshot review round trips',()=>{
  test('keeps coordinates and crop separate from editable prose, across repeated saves',()=>{
    const first=noteFromComment(comment);
    let markdown=renderMarkdown({range:'HEAD',notes:[first]});
    expect(markdown).toContain('x=100, y=4200, width=300, height=120');
    expect(markdown).toContain('![Selected screenshot region](images/012345.png)');
    for(let i=0;i<3;i++){
      const doc=parseReview(markdown);
      expect(doc.notes[0]).toMatchObject({...comment,key:'screen.png (whole file)'});
      markdown=renderMarkdown(doc);
    }
  });
  test('old-side regions and agent messages survive a reviewer edit from an older tab',()=>{
    const original=noteFromComment({...comment,image:{...region,side:'old'}});
    original.status='applied'; original.messages=[{role:'agent',at:'now',body:'Adjusted the spacing.'}];
    const {image,...older}=comment;
    const next=applyComment(original,{...older,body:'Also adjust the label.'});
    const parsed=parseReview(renderMarkdown({range:'HEAD',notes:[next]})).notes[0]!;
    expect(parsed.image?.side).toBe('old');
    expect(parsed.status).toBe('applied');
    expect(parsed.messages).toEqual(original.messages);
    expect(parsed.body).toBe('Also adjust the label.');
  });
  test('metadata quoted in reviewer prose stays prose, including a whole generated block',()=>{
    const body=imageRegionLines(region).join('\n')+'\nPlease explain this format.';
    const parsed=parseReview(renderMarkdown({range:'HEAD',notes:[noteFromComment({...comment,image:undefined,body})]}));
    expect(parsed.notes[0]!.image).toBeUndefined();
    expect(parsed.notes[0]!.body).toBe(body.trim());
  });
});
