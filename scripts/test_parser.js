const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(from, to) {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing parser section ${from}`);
  return html.slice(start, end);
}
const context = vm.createContext({STAT_WEEKS: 17, MAX_WEEK: 20});
vm.runInContext(`
  function emptyGrid(){ return Array.from({length:7},()=>Array.from({length:7},()=>[])); }
  ${section('function parseWeeks(raw){', '/* 全 1-17 周 */')}
  ${section('function allWeeks(){', '/* 单周 / 双周')}
  ${section('var SLOT_BY_PERIOD =', '/* ---------- PDF ---------- */')}
  ${section('function paddleTokens(items){', 'var _ocrWorker=')}
  ${section('async function enhancePaddleCells(', 'function guardUnreadCells(')}
  ${section('function guardUnreadCells(', 'function cellTextQuality(')}
  ${section('function cellTextQuality(data){', 'async function ocrGridCells(')}
`, context);

assert.ok(context.cellTextQuality({text:'马克思主义基本原理/1-15周(单)',confidence:65})
  > context.cellTextQuality({text:'马克思主又基木原理',confidence:95}),
  'a legible week range must outrank high-confidence text with no week information');
assert.ok(context.cellTextQuality({text:'高等数学/第１至第４周',confidence:65})>100,
  'the fallback OCR scorer must recognize the same normalized weeks as the course parser');

function token(text, x, y, width = 70) {
  return {text, x0:x, y0:y, x1:x+width, y1:y+12, cx:x+width/2, cy:y+6, h:12};
}
function fixture(days) {
  const tokens=[];
  const names=['一','二','三','四','五','六','日'];
  for(let day=0;day<days;day++) tokens.push(token('星期'+names[day], 100+day*100, 50));
  const periods=[1,3,5,6,8,10,12];
  for(let slot=0;slot<7;slot++) tokens.push(token('第'+periods[slot]+'节', 0, 100+slot*100, 30));
  tokens.push(token('马克思主义基本原理/1-15周(单)/四教209/王相忍', 100+4*100, 500, 80));
  return tokens;
}
for(const days of [5,7]) {
  const parsed=context.buildGrid(fixture(days), '郑懿婷.png');
  assert.equal(parsed.courseCount, 1, `${days}-day header should be recognized`);
  const course=parsed.grid[4][4][0];
  assert.equal(course.name, '马克思主义基本原理');
  assert.equal(course.weeks[5], true);
  assert.equal(course.weeks[6], false, 'week 6 is even, so this odd-week course is off');
  assert.equal(course.weeks[15], true);
  assert.equal(course.weeks[16], false);
}

assert.equal(context.parseWeeks('第19周'), null, 'weeks outside the 17-week term require review');
assert.ok(context.fieldsToCourses('示例课程/第19周')[0].name.startsWith('待核对：'),
  'an unreadable or out-of-term week must not silently become a free slot');

for(const [raw,expected] of [
  ['1,3,5周',[1,3,5]],
  ['第1、3、5周',[1,3,5]],
  ['1-3,5-9周',[1,2,3,5,6,7,8,9]],
  ['1-8周(单),10-16周(双)',[1,3,5,7,10,12,14,16]],
  ['第１至第４周',[1,2,3,4]],
  ['１－５周（单）',[1,3,5]]
]) {
  const weeks=context.parseWeeks(raw);
  assert.ok(weeks, `${raw} should be recognized`);
  assert.deepEqual(Array.from({length:20},(_,i)=>i+1).filter(week=>weeks[week]), expected,
    `${raw} should preserve each listed week and its own parity`);
}
for(const raw of ['第6周(单)','第19周(双)','1-170周']) {
  assert.equal(context.parseWeeks(raw), null, `${raw} must require review instead of expanding to a whole term`);
}
for(const name of ['市场营销','图书馆学','课堂教学设计']) {
  const courses=context.fieldsToCourses(name+'/1-17周/四教101/李老师');
  assert.equal(courses.length,1);
  assert.equal(courses[0].name,name, `${name} must not be mistaken for a classroom`);
}
for(const [raw,name,expected] of [
  ['高等数学/第１至第４周/四教101/李老师','高等数学',[1,2,3,4]],
  ['基础医学概论/1-17周四教405/李老师','基础医学概论',Array.from({length:17},(_,i)=>i+1)]
]) {
  const courses=context.fieldsToCourses(raw);
  assert.equal(courses.length,1);
  assert.equal(courses[0].name,name);
  assert.deepEqual(Array.from({length:20},(_,i)=>i+1).filter(week=>courses[0].weeks[week]),expected,
    'course parsing must preserve normalized week text and a missing classroom separator');
}

const layout=fixture(5).slice(0,-1);
const missingWednesday=layout.filter(t=>t.text!=='星期三')
  .concat(token('高等数学/1-17周',400,200,80));
const missingHeaderParsed=context.buildGrid(missingWednesday,'sample.png');
assert.equal(missingHeaderParsed.courseCount,1);
assert.equal(missingHeaderParsed.grid[3][1][0].name,'高等数学',
  'a missing Wednesday header must not shift a Thursday course into Wednesday');
assert.equal(missingHeaderParsed.grid[2][1].length,0);

const fifthPeriodParsed=context.buildGrid(layout.concat(token('实验课/1-17周',100,300,80)),'sample.png');
assert.equal(fifthPeriodParsed.courseCount,1);
assert.equal(fifthPeriodParsed.grid[0][2][0].name,'实验课',
  'a real fifth-period course must survive the text-coordinate parser');

const lowConfidenceWeeks=context.paddleTokens([{text:'1-15周(单)',score:0.3,
  poly:[[100,216],[170,216],[170,228],[100,228]]}]);
assert.equal(lowConfidenceWeeks.length,1, 'low-confidence parity text must survive for review');
assert.equal(lowConfidenceWeeks[0].score,0.3);
const lowConfidenceParsed=context.buildGrid(layout.concat(token('高等数学/',100,200,80),
  Array.from(lowConfidenceWeeks)),'sample.png');
assert.ok(lowConfidenceParsed.grid[0][1].some(course=>course.name.startsWith('待核对：')),
  'uncertain odd/even-week text must prevent a silently confirmed schedule');

// OCR may lose every weekday label. A five-day timetable must still map its
// equal-width course columns correctly, skipping the equally wide time column.
const width=1210, height=992, pixels=new Uint8ClampedArray(width*height*4);
pixels.fill(255);
function black(x,y){const k=(y*width+x)*4;pixels[k]=pixels[k+1]=pixels[k+2]=0;}
for(const x of [29,60,91,276,462,648,834,1019,1204])
  for(let y=25;y<=946;y++)black(x,y);
for(const y of [25,64,90,233,375,518,661,803,946])
  for(let x=29;x<=1204;x++)black(x,y);
context.document={createElement(){return {width:0,height:0,getContext(){return {
  drawImage(){},getImageData(){return {data:pixels};}
};}};}};
const geometry=context.tableGeometry({width,height});
assert.equal(geometry.colBands.length,5);
assert.equal(geometry.rowBands.length,6);
assert.equal(geometry.colBands[0].col,0);
assert.ok(geometry.colBands[0].l>276 && geometry.colBands[0].l<285);
assert.equal(geometry.colBands[4].col,4);
assert.deepEqual(Array.from(geometry.rowBands[3].slots),[4]);
console.log('parser regression checks passed');

(async function(){
  const source={width:200,height:100};
  let enhancementPixels=new Uint8ClampedArray(source.width*source.height*4);
  enhancementPixels.fill(255);
  for(let y=30;y<60;y++)for(let x=120;x<180;x++){
    const index=(y*source.width+x)*4;
    enhancementPixels[index]=enhancementPixels[index+1]=enhancementPixels[index+2]=190;
  }
  context.document={createElement(){return {width:0,height:0,getContext(){return {
    drawImage(){},fillRect(){},getImageData(){return {data:enhancementPixels};}
  };}};}};
  const twoCells={colBands:[{l:0,r:100,col:0},{l:100,r:200,col:1}],
    rowBands:[{l:0,r:100,slots:[0]}]};
  const clearTokens=[Object.assign(token('数据结构/1-17周',10,30,80),{score:0.99})];
  const failedReread=await context.enhancePaddleCells(source,twoCells,clearTokens,{
    async predict(){throw new Error('temporary OCR failure');}
  });
  const failureParsed=context.guardUnreadCells(source,twoCells,
    context.buildGrid(failedReread,'sample.png',twoCells));
  assert.ok(failureParsed.grid[1][0].some(course=>course.name.startsWith('待核对：')),
    'faint text must require review when its local OCR fails instead of becoming a free slot');
  assert.ok(failureParsed.grid[0][0].some(course=>course.name==='数据结构'),
    'a failed local reread must retain a previously recognized course');

  enhancementPixels=new Uint8ClampedArray(source.width*source.height*4);
  enhancementPixels.fill(255);
  const singleCell={colBands:[{l:0,r:200,col:0}],rowBands:[{l:0,r:100,slots:[0]}]};
  const original=[
    Object.assign(token('课程甲甲/1-8周/四教101/张三/',10,15,170),{score:0.91,h:16,y1:31,cy:23}),
    Object.assign(token('课程乙乙/9-17周/四教102/李四/',10,55,170),{score:0.91,h:16,y1:71,cy:63})
  ];
  const beforeSwap=context.buildGrid(original,'sample.png',singleCell);
  assert.deepEqual(Array.from(beforeSwap.grid[0][0],course=>course.name),['课程甲甲','课程乙乙'],
    'the conflict fixture must start with two valid, distinguishable courses');
  const swapped=await context.enhancePaddleCells(source,singleCell,original,{
    async predict(){return [{items:[
      {text:'课程甲甲/9-17周/四教101/张三/',score:0.99,poly:[[28,38],[368,38],[368,70],[28,70]]},
      {text:'课程乙乙/1-8周/四教102/李四/',score:0.99,poly:[[28,118],[368,118],[368,150],[28,150]]}
    ]}];}
  });
  const swappedParsed=context.buildGrid(swapped,'sample.png',singleCell);
  assert.ok(swappedParsed.grid[0][0].some(course=>course.name.startsWith('待核对：')),
    'swapping week ranges between the same two courses must require review even when the occupied-week union is unchanged');
  console.log('local OCR enhancement regression checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
