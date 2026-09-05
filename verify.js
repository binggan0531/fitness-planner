// node verify.js  —— 驗證核心邏輯與介面能否跑完
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let failed = false;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed = true; };

/* ---- 1. 純邏輯(不給 document,UI 區塊會跳過) ---- */
new Function(code)();
const A = globalThis.__api;

// 手算對照:男 28y 172cm 70kg,BMR = 10*70 + 6.25*172 - 5*28 + 5 = 1640
const m = A.nutrition({sex:'male', age:28, height:172, weight:70, activity:'light', goal:'bulk'});
check('BMR 公式(男)', m.bmr === 1640);
check('TDEE = BMR × 活動係數', m.tdee === Math.round(1640 * 1.375));
check('增肌熱量 = TDEE × 1.12', m.kcal === Math.round(m.tdee * 1.12));
check('蛋白質 1.8 g/kg', m.protein === 126);

const f = A.nutrition({sex:'female', age:30, height:160, weight:55, activity:'sed', goal:'cut'});
check('BMR 公式(女)', f.bmr === 1239);
check('減脂蛋白質 2.2 g/kg', f.protein === 121);
for (const [n, N] of [['男增肌', m], ['女減脂', f]]) {
  const sum = N.protein*4 + N.carb*4 + N.fat*9;
  check(`三大營養素熱量加總 ≈ 目標熱量(${n},誤差 ${Math.abs(sum-N.kcal)} kcal)`, Math.abs(sum - N.kcal) <= N.kcal*0.02);
  check(`碳水不為負(${n})`, N.carb > 0);
}

// 各種體型的營養處方都要落在文獻範圍內
const bodies = [
  ['瘦男', {sex:'male', age:30, height:175, weight:60}], ['一般男', {sex:'male', age:30, height:175, weight:75}],
  ['肥胖男', {sex:'male', age:30, height:175, weight:105}], ['一般女', {sex:'female', age:35, height:160, weight:55}],
  ['肥胖女', {sex:'female', age:40, height:160, weight:97}], ['年長女', {sex:'female', age:70, height:155, weight:52}],
  ['青少年男', {sex:'male', age:15, height:170, weight:58}],
];
let macroOk = true, macroMsg = '';
for (const [n, b] of bodies)
  for (const goal of Object.keys(A.GOAL))
    for (const act of Object.keys(A.ACT)) {
      const N = A.nutrition({...b, goal, activity:act});
      const pPct = N.protein*4 / N.kcal, fPct = N.fat*9 / N.kcal;
      // 蛋白質過高會擠掉碳水與脂肪;文獻的有效區間是 1.6-2.2 g/kg(基準體重)
      // 低熱量減脂時蛋白質佔比自然會高(保肌),45% 才算異常
      if (pPct > 0.45) { macroOk = false; macroMsg = ` (${n}/${goal}:蛋白佔 ${Math.round(pPct*100)}% 熱量)`; }
      if (N.protein / N.refW > 3.1) { macroOk = false; macroMsg = ` (${n}/${goal}:${(N.protein/N.refW).toFixed(1)} g/kg 超過 Helms 上限)`; }
      if (N.protein / N.refW < 1.6) { macroOk = false; macroMsg = ` (${n}/${goal}:蛋白 ${(N.protein/N.refW).toFixed(1)} g/kg 低於 1.6)`; }
      // 脂肪低於總熱量 15-20% 與男性睪固酮下降有關
      if (fPct < 0.18) { macroOk = false; macroMsg = ` (${n}/${goal}:脂肪只佔 ${Math.round(fPct*100)}% 熱量)`; }
      if (N.carb <= 0) { macroOk = false; macroMsg = ` (${n}/${goal}:碳水 ${N.carb} g)`; }
    }
check('各種體型的三大營養素都落在文獻範圍' + macroMsg, macroOk);

// 熱量不能算到不安全的低點:女性 1200 / 男性 1500,且不低於基礎代謝
let floorOk = true, floorMsg = '';
for (const [n, b] of bodies)
  for (const act of Object.keys(A.ACT)) {
    const N = A.nutrition({...b, goal:'cut', activity:act});
    const limit = Math.min(N.tdee, b.sex === 'male' ? 1500 : 1200);
    if (N.kcal < limit) { floorOk = false; floorMsg = ` (${n}: ${N.kcal} < ${limit} kcal)`; }
    if (N.kcal < N.bmr && !/N\.belowBmr \?/.test(html)) { floorOk = false; floorMsg = ` (${n}: 低於基礎代謝卻沒有提醒)`; }
  }
check('減脂熱量不會低於安全下限,低於基礎代謝時有提醒' + floorMsg,
  floorOk && /N\.floored/.test(html) && /N\.belowBmr/.test(html) && /不建議長期維持/.test(html));

// 體重趨勢的校正必須真的能改變熱量,不能被下限吃掉還顯示按鈕
{
  const p1 = {sex:'male', age:40, height:175, weight:90, activity:'sed', goal:'cut'};
  const base = A.nutrition(p1).kcal;
  check(`減脂中的校正真的會生效(${base} → ${A.nutrition({...p1, kcalAdjust:-200}).kcal})`,
    A.nutrition({...p1, kcalAdjust:-200}).kcal === base - 200);
}

// 體脂高的人不能用總體重算蛋白質(脂肪組織不需要蛋白質維持)
const fatMan = A.nutrition({sex:'male', age:30, height:175, weight:105, goal:'cut', activity:'light'});
const fitMan = A.nutrition({sex:'male', age:30, height:175, weight:70, goal:'cut', activity:'light'});
check('BMI 偏高時蛋白質改用基準體重,且畫面上有說明',
  fatMan.refUsed && fatMan.refW < 105 && /refUsed/.test(html) && /脂肪組織不需要蛋白質/.test(html));
check('BMI 正常時不動用基準體重', !fitMan.refUsed && fitMan.protein === 70*2.2);

// 程式接受 14-90 歲,兩端要有對應的提醒
check('未成年與 65 歲以上有對應提醒', /p\.age < 18/.test(html) && /NSCA/.test(html)
  && /p\.age >= 65/.test(html) && /物理治療師/.test(html));

// 課表:所有天數 × 經驗 × 器材組合
const combos = [['bodyweight'], ['bodyweight','dumbbell'], ['bodyweight','dumbbell','barbell','machine','cable','band','bar'], ['band']];
let planOk = true, equipOk = true, setsOk = true;
for (const days of [1,2,3,4,5,6])
  for (const exp of Object.keys(A.EXP))
    for (const eq of combos) {
      const plan = A.buildPlan({days, experience:exp, equipment:eq});
      if (plan.length !== days) planOk = false;
      for (const d of plan) {
        const items = d.items.filter(i => i.id);
        if (!items.length) planOk = false;
        if (new Set(items.map(i => i.id)).size !== items.length) planOk = false; // 同一天不重複動作
        for (const i of items) {
          const ex = A.EX.find(e => e.id === i.id);
          if (!ex.equip.some(q => eq.includes(q))) equipOk = false;   // 只排使用者有的器材
          if (!(i.sets >= 2 && i.sets <= 5 && i.lo > 0 && i.lo < i.hi && i.rir)) setsOk = false;
          if (i.rest < (i.c ? 120 : 90)) setsOk = false;   // Schoenfeld 2016:複合動作至少 2 分鐘
        }
      }
    }
check('每種天數/經驗/器材組合都排得出課表', planOk);
check('不會排出使用者沒有的器材動作', equipOk);
check('組數次數區間與休息時間合理', setsOk);

const bwPlan = A.buildPlan({days:3, experience:'beginner', equipment:['bodyweight']});
check('只有徒手時仍排得出課表', bwPlan.every(d => d.items.filter(i=>i.id).length >= 4));
check('練不到的部位有標記出來', bwPlan.some(d => d.items.some(i => i.miss === 'biceps')));

// 雙漸進
const it = {lo:8, hi:12, sets:3, inc:2.5};
check('首次訓練不給重量,要自測', A.nextTarget(it, null).weight === null);
check('全部做滿 → 加重一個增量', A.nextTarget(it, {weight:40, reps:[12,12,12], fail:0}).weight === 42.5);
check('未達下限且已連兩次 → 減重約 10%', A.nextTarget(it, {weight:40, reps:[7,7,6], fail:1}).weight === 35);
const mid = A.nextTarget(it, {weight:40, reps:[10,9,9], fail:0});
check('中間狀態 → 同重量、次數往上推', mid.weight === 40 && mid.reps === 11);
const bw = {lo:8, hi:12, sets:3, inc:0};
check('徒手動作全做滿 → 加次數不加重', A.nextTarget(bw, {weight:0, reps:[12,12,12], fail:0}).reps === 14);

// 食物庫:熱量與三大營養素互相對得上(蔬菜纖維多,容差放寬)
const bad = A.FOOD.filter(([, n, k, p, c, ft]) => Math.abs(p*4 + c*4 + ft*9 - k) > Math.max(k*0.3, 12)).map(x => x[1]);
check('食物熱量與營養素一致' + (bad.length ? ':' + bad.join('、') : ''), bad.length === 0);

/* ---- 2. 介面:給假 DOM,四個分頁都要渲染得出東西 ---- */
const mkEl = id => ({id, innerHTML:'', hidden:id !== 'setup', value:'', checked:true,
  dataset:{}, classList:{toggle(){}, add(){}, remove(){}}, querySelectorAll:()=>[]});
const els = {};
const tabs = ['setup','plan','log','diet'].map(t => ({dataset:{tab:t}, classList:{toggle(){}}, onclick:null}));
globalThis.document = {
  getElementById: id => els[id] || (els[id] = mkEl(id)),
  querySelectorAll: sel => sel === 'nav button' ? tabs : [],
  querySelector: sel => tabs.find(t => sel.includes(`"${t.dataset.tab}"`)) || null,
};
const store = {};
globalThis.localStorage = {getItem:k=>store[k]??null, setItem:(k,v)=>{store[k]=String(v)}, removeItem:k=>{delete store[k]}};
globalThis.confirm = () => false;
new Function(code)();

check('設定頁有渲染出表單', /f_save/.test(els.setup.innerHTML) && /f_weight/.test(els.setup.innerHTML));
for (const t of tabs.slice(1)) {
  ['setup','plan','log','diet'].forEach(x => els[x] && (els[x].hidden = x !== t.dataset.tab));
  t.onclick();
  const out = els[t.dataset.tab].innerHTML;
  check(`${t.dataset.tab} 分頁有內容且無 undefined`, out.length > 300 && !/undefined|NaN/.test(out));
}

/* ---- 2.5 每週訓練量要達到文獻門檻(時間充裕時) ---- */
// ACSM 2026 位置聲明:肌肥大每個肌群每週 >=10 組。新手用較低量也能進步,門檻放寬到 8 組。
const FULL = combos[2];
const prof = (o) => ({equipment:FULL, warmup:true, stretch:true, ...o});
let volOk = true, volMsg = '';
for (const days of [1,2,3,4,5,6])
  for (const exp of Object.keys(A.EXP)) {
    const floor = exp === 'beginner' ? 8 : 9;   // 取整會有 ±1 組誤差
    const plan = A.buildPlan(prof({days, experience:exp, minutes:120}));
    if (plan.some(d => d.capped)) continue;      // 時間裝不下的配置在下面另外檢查
    const v = A.weeklyVolume(plan);
    for (const [g, sets] of Object.entries(v))
      if (sets < (days === 1 ? 4 : floor) && !['calves','glutes','core'].includes(g)) {
        volOk = false; volMsg = ` (${exp} ${days}天 ${g}=${sets})`;
      }
  }
check('每個主要肌群的週組數達到門檻(時間充裕時)' + volMsg, volOk);

/* ---- 2.6 每次訓練要排得進使用者設定的時間 ---- */
let timeOk = true, timeMsg = '', droppedSeen = false, cappedSeen = false;
for (const mins of [30,45,60,75,90,120])
  for (const days of [1,2,3,4,5,6])
    for (const exp of Object.keys(A.EXP)) {
      const p = prof({days, experience:exp, minutes:mins});
      for (const d of A.buildPlan(p)) {
        const items = d.items.filter(i => i.id);
        if (d.minutes !== A.estMinutes(items, p)) { timeOk = false; timeMsg = ' (顯示的分鐘數與實算不符)'; }
        // 砍到只剩 3 個部位、每個動作都只剩 2 組還是超時,才允許超過預算
        const floorReached = new Set(items.map(i => i.g)).size <= 3 && items.every(i => i.sets <= 2);
        if (d.minutes > mins && !floorReached) {
          timeOk = false; timeMsg = ` (${exp} ${days}天 預算${mins}分 → ${d.minutes}分)`;
        }
        if (d.dropped.length) droppedSeen = true;
        if (d.capped) cappedSeen = true;
      }
    }
check('每天的預估時間排得進設定的時間預算' + timeMsg, timeOk);
check('時間不夠時會縮減組數,課表頁有寫明', cappedSeen && /d\.capped/.test(html) && /組數已縮減/.test(html));
check('時間嚴重不足時會整個部位移出當天,並列出是哪些部位',
  droppedSeen && /d\.dropped/.test(html) && /移出這一天/.test(html));

// 時間拉長,練到的量就要變多(這個設定必須真的有作用)
const sum = v => Object.values(v).reduce((a,b) => a+b, 0);
const short = sum(A.weeklyVolume(A.buildPlan(prof({days:4, experience:'intermediate', minutes:30}))));
const long  = sum(A.weeklyVolume(A.buildPlan(prof({days:4, experience:'intermediate', minutes:120}))));
check(`時間拉長會練到更多組(30 分=${short} 組 → 120 分=${long} 組)`, long > short * 1.5);

/* ---- 2.7 體脂、年齡、體重趨勢三項校正 ---- */
// 有填體脂就用去脂體重算蛋白質,且要落在 Helms 的 2.3-3.1 g/kg 去脂體重
let lbmOk = true, lbmMsg = '';
for (const bf of [8,15,25,35,45])
  for (const goal of Object.keys(A.GOAL)) {
    const N = A.nutrition({sex:'male', age:30, height:175, weight:90, activity:'light', goal, bodyfat:bf});
    const lbm = 90 * (1 - bf/100), gPerLbm = N.protein / lbm;
    if (!N.lbmUsed) { lbmOk = false; lbmMsg = ' (沒有改用去脂體重)'; }
    if (gPerLbm < 2.0 || gPerLbm > 3.1) { lbmOk = false; lbmMsg = ` (體脂${bf}%/${goal}:${gPerLbm.toFixed(1)} g/kg 去脂體重)`; }
  }
check('填了體脂就改用去脂體重,且落在文獻區間' + lbmMsg, lbmOk);
check('沒填體脂時維持原本的推估', !A.nutrition({sex:'male', age:30, height:175, weight:90, activity:'light', goal:'cut'}).lbmUsed);

// 未滿 18 與 65 歲以上:不排 8 次以下的重負荷,並多留一次餘力
let ageOk = true, ageMsg = '';
for (const age of [15, 17, 65, 80])
  for (const exp of Object.keys(A.EXP)) {
    const base = A.EXP[exp], adj = A.ageAdjust(base, age);
    if (adj.compRep[0] < 8 || adj.rir[0] <= base.rir[0]) { ageOk = false; ageMsg = ` (${age}歲/${exp})`; }
    for (const d of A.buildPlan({days:4, experience:exp, age, equipment:combos[2], minutes:90, warmup:true, stretch:true}))
      for (const i of d.items) if (i.id && i.lo < 8) { ageOk = false; ageMsg = ` (${age}歲 排到 ${i.lo} 次的 ${i.n})`; }
  }
check('未成年與 65 歲以上不排 8 次以下的重負荷' + ageMsg, ageOk);
for (const age of [18, 30, 64]) {
  const adj = A.ageAdjust(A.EXP.advanced, age);
  if (adj.compRep[0] !== 5) { check(`${age} 歲不該被年齡調整`, false); }
}
check('18-64 歲不受年齡調整影響', A.ageAdjust(A.EXP.advanced, 30).compRep[0] === 5);

// 體重趨勢的建議方向不能寫反
const mk = (from, to, days) => [{date:'2026-08-01', w:from},
  {date:new Date(+new Date('2026-08-01') + days*864e5).toISOString().slice(0,10), w:to}];
const R = (goal, pace) => A.GOAL[goal].paces[pace || 'std'].rate;
const cases = [
  ['減脂 掉太慢', R('cut'),  mk(80, 79.6, 21), -200],
  ['減脂 掉太快', R('cut'),  mk(80, 76.5, 21),  200],
  ['減脂 剛剛好', R('cut'),  mk(80, 78.7, 21),    0],
  ['增肌 增太慢', R('bulk'), mk(70, 70.1, 21),  200],
  ['增肌 增太快', R('bulk'), mk(70, 72.5, 21), -200],
  ['增肌 剛剛好', R('bulk'), mk(70, 70.8, 21),    0],
  ['維持 掉太多', R('maintain'), mk(70, 68.9, 21), 200],
  ['減脂保守 掉太快', R('cut','slow'), mk(80, 78.7, 21), 200],   // 同樣的變化,保守節奏視為太快
  ['減脂積極 掉太慢', R('cut','fast'), mk(80, 78.7, 21), -200],  // 同樣的變化,積極節奏視為太慢
];
let trendOk = true, trendMsg = '';
for (const [n, rate, logs, want] of cases) {
  const t = A.weightTrend(logs, rate);
  if (!t || t.adjust !== want) { trendOk = false; trendMsg += ` (${n}: 得到 ${t ? t.adjust : 'null'} 應為 ${want})`; }
}
check('體重趨勢給的熱量調整方向正確' + trendMsg, trendOk);
// 每天記錄時要用頭尾各一週的平均,不能被單日的水分波動帶偏方向
{
  const day = i => new Date(+new Date('2026-08-01') + i*864e5).toISOString().slice(0,10);
  const daily = [];
  for (let i = 0; i <= 21; i++) daily.push({date:day(i), w:+(80 - 80*0.005*(i/7)).toFixed(1)});  // 真實 -0.5%/週
  const spike = daily.map((x,i) => i === 21 ? {...x, w:x.w + 2} : x);                            // 最後一天水腫 +2kg
  const clean = A.weightTrend(daily, R('cut')), noisy = A.weightTrend(spike, R('cut'));
  const twoPoint = A.weightTrend([spike[0], spike[21]], R('cut'));
  check(`乾淨資料算得出真實趨勢(${clean.pct.toFixed(2)}%/週,實際 -0.5%)`, Math.abs(clean.pct + 0.5) < 0.05 && clean.adjust === 0);
  check(`單日水腫不會讓趨勢反向(平均法 ${noisy.pct.toFixed(2)}% vs 單點法 ${twoPoint.pct.toFixed(2)}%)`,
    noisy.pct < 0 && twoPoint.pct > 0);
  check('有多筆資料時會標示為已平滑', clean.smoothed === true && clean.n === 22);
  check('只有兩筆時照樣能算,但標示未平滑', twoPoint.smoothed === false && twoPoint.n === 2);
  check('頭尾窗口間隔不足一週時視為資料不足',
    A.weightTrend([{date:day(0), w:80}, {date:day(1), w:79.9}, {date:day(15), w:79}].slice(0,2), R('cut')).tooShort === true);
}
check('資料不足兩週時不給建議', A.weightTrend(mk(80, 79, 5), R('cut')).tooShort === true);
check('只有一筆體重時不算趨勢', A.weightTrend([{date:'2026-08-01', w:80}], R('cut')) === null);

// 校正值要真的影響熱量,但不能突破安全下限
const pBig = {sex:'male', age:30, height:178, weight:80, activity:'mod', goal:'bulk'};
check('校正值會影響每日熱量',
  A.nutrition({...pBig, kcalAdjust:-200}).kcal === A.nutrition(pBig).kcal - 200 &&
  A.nutrition({...pBig, kcalAdjust:300}).kcal === A.nutrition(pBig).kcal + 300);
const pSmall = {sex:'female', age:35, height:160, weight:55, activity:'light', goal:'cut'};
check('校正值不會把熱量壓破安全下限',
  A.nutrition({...pSmall, kcalAdjust:-2000}).kcal >= Math.min(A.nutrition(pSmall).tdee, 1200));
// 同一頁不能出現兩組互相矛盾的目標速率(舊的靜態說明必須清掉)
check('目標速率只有一個出處', !/增肌每月/.test(html) && /體重趨勢/.test(html));
check('體重記錄與套用校正的介面都在', /w_add/.test(html) && /w_apply/.test(html) && /weightTrend/.test(html));

/* ---- 2.8 目標節奏、部位分配、體脂目標、拉長位置動作 ---- */
// 熱量係數要和它宣告的體重變化速率對得上(7700 kcal ≈ 1 kg)
let paceOk = true, paceMsg = '';
for (const body of [{sex:'male', age:30, height:175, weight:80}, {sex:'female', age:35, height:162, weight:60}])
  for (const goal of Object.keys(A.GOAL))
    for (const pace of Object.keys(A.GOAL[goal].paces)) {
      const N = A.nutrition({...body, activity:'light', goal, pace});
      const perWeek = (N.goalKcal - N.tdee) * 7 / 7700;              // 每週體重變化(kg)
      const pct = perWeek / body.weight * 100;
      const [lo, hi] = A.GOAL[goal].paces[pace].rate;
      if (pct < lo - 0.12 || pct > hi + 0.12) {
        paceOk = false; paceMsg = ` (${goal}/${pace}:熱量推算 ${pct.toFixed(2)}%/週,宣告 ${lo}~${hi}%)`;
      }
    }
check('每個節奏的熱量係數與宣告的速率一致' + paceMsg, paceOk);

// 節奏要真的有差:積極比保守的熱量差距明顯
{
  const b = {sex:'male', age:30, height:175, weight:80, activity:'light'};
  const cs = A.nutrition({...b, goal:'cut', pace:'slow'}).kcal, cf = A.nutrition({...b, goal:'cut', pace:'fast'}).kcal;
  const bs = A.nutrition({...b, goal:'bulk', pace:'slow'}).kcal, bf = A.nutrition({...b, goal:'bulk', pace:'fast'}).kcal;
  check(`減脂節奏拉得開(保守 ${cs} vs 積極 ${cf} kcal)`, cs - cf > 200);
  check(`增肌節奏拉得開(精瘦 ${bs} vs 積極 ${bf} kcal)`, bf - bs > 150);
}

// 部位分配要真的改變訓練量,而且總量不會失控
{
  const base = {days:5, experience:'intermediate', equipment:combos[2], minutes:90, warmup:true, stretch:true};
  const bal = A.weeklyVolume(A.buildPlan({...base, focus:'balanced'}));
  const vt  = A.weeklyVolume(A.buildPlan({...base, focus:'vtaper'}));
  const lo  = A.weeklyVolume(A.buildPlan({...base, focus:'lower'}));
  check(`選 V 型時肩背變多、腿變少(肩 ${bal.shoulders}→${vt.shoulders}、股四頭 ${bal.quads}→${vt.quads})`,
    vt.shoulders > bal.shoulders && vt.quads < bal.quads);
  check(`選下半身時臀腿變多(臀 ${bal.glutes}→${lo.glutes}、股四頭 ${bal.quads}→${lo.quads})`,
    lo.glutes > bal.glutes && lo.quads >= bal.quads);
  const sum = v => Object.values(v).reduce((a,b) => a+b, 0);
  check('偏重某部位是重新分配而不是加量(總量不變)', Math.abs(sum(vt) - sum(bal)) < sum(bal) * 0.15);
  // 被調低的部位要留在維持水準(文獻:維持所需約為增長所需的三分之一),不能被榨乾
  let keepOk = true, keepMsg = '';
  for (const days of [4,5,6])
    for (const mins of [75,90,120])
      for (const focus of ['vtaper','lower','arms']) {
        const v = A.weeklyVolume(A.buildPlan({...base, days, minutes:mins, focus}));
        for (const [g, sets] of Object.entries(v))
          // Bickel 2011:年輕人用原本 1/9 的量(每週 3 組)可維持 32 週,所以維持門檻取 4 組
          if (sets < 4 && !['calves','core'].includes(g)) { keepOk = false; keepMsg = ` (${focus}/${days}天/${mins}分 ${g}=${sets})`; }
      }
  check('被調低的部位仍留在維持水準(≥4 組)' + keepMsg, keepOk);

  // 時間吃緊時分配不能被磨平——這是最容易失效的情況
  let tightOk = true, tightMsg = '';
  for (const days of [4,5,6]) {
    const b2 = {...base, days, minutes:75};
    const bal2 = A.weeklyVolume(A.buildPlan({...b2, focus:'balanced'}));
    const vt2 = A.weeklyVolume(A.buildPlan({...b2, focus:'vtaper'}));
    const lo2 = A.weeklyVolume(A.buildPlan({...b2, focus:'lower'}));
    if (!(vt2.shoulders > bal2.shoulders && vt2.quads < bal2.quads)) { tightOk = false; tightMsg = ` (V型/${days}天)`; }
    if (!(lo2.glutes > bal2.glutes && lo2.chest <= bal2.chest)) { tightOk = false; tightMsg += ` (下肢/${days}天)`; }
  }
  check('時間只有 75 分鐘時分配依然有效' + tightMsg, tightOk);
  check('重點部位會連分化一起調整',
    A.buildPlan({...base, days:4, minutes:90, focus:'vtaper'}).filter(d => /上肢/.test(d.name)).length === 3 &&
    A.buildPlan({...base, days:4, minutes:90, focus:'lower'}).filter(d => /下肢/.test(d.name)).length === 2);
  check('課表頁有說明這是重新分配、維持水準的依據、以及長者的例外',
    /重新分配,不是加量/.test(html) && /Bickel 2011/.test(html) && /p\.age >= 65/.test(html));
}

// 體脂目標的推算
{
  const p = {sex:'male', age:30, height:175, weight:82, bodyfat:22, activity:'light'};
  const cut = A.bfPlan({...p, goal:'cut', pace:'std', targetBf:14});
  const fast = A.bfPlan({...p, goal:'cut', pace:'fast', targetBf:14});
  check(`減脂目標推算合理(82kg/22% → ${cut.goalW}kg/14%,約 ${cut.weeks} 週)`,
    cut.goalW > 70 && cut.goalW < 78 && cut.weeks > 8 && cut.weeks < 40);
  check(`節奏越積極,達標越快(標準 ${cut.weeks} 週 vs 積極 ${fast.weeks} 週)`, fast.weeks < cut.weeks);
  check('去脂體重推算正確', Math.abs(cut.lbm - 82*0.78) < 0.2);
  check('目標與方向矛盾時會標記出來', A.bfPlan({...p, goal:'bulk', pace:'std', targetBf:14}).mismatch === true);
  check('沒填體脂就不做推算', A.bfPlan({sex:'male', age:30, height:175, weight:82, goal:'cut', pace:'std', targetBf:14}) === null);
  check('體脂目標與安全下限的說明都在', /安全下限/.test(html) && /BF\[/.test(html) && /bfLabel/.test(html));
}

// 拉長位置的動作要被標記,而且排序偏好它
{
  const ml = A.EX.filter(e => e.ml);
  check(`有標記拉長位置的動作(${ml.length} 個)`, ml.length >= 20);
  check('拉長位置標記涵蓋主要部位',
    new Set(ml.map(e => e.g)).size >= 7 && ml.some(e => e.id === 'rdl') && ml.some(e => e.id === 'db_fly'));
  // 同一個部位若有拉長與非拉長的同級動作,課表要偏好前者
  const plan = A.buildPlan({days:4, experience:'intermediate', equipment:['dumbbell','barbell','machine','cable'],
    minutes:90, warmup:true, stretch:true, focus:'balanced'});
  const picked = plan.flatMap(d => d.items.filter(i => i.id));
  const mlShare = picked.filter(i => A.EX.find(e => e.id === i.id).ml).length / picked.length;
  // 有些部位本來就沒有拉長位置的選項(肩中束、臀推、三頭下壓),所以不會是壓倒性多數
  check(`課表裡有相當比例的拉長位置動作(${Math.round(mlShare*100)}%)`, mlShare > 0.33);

  // 同部位、同樣可加重、同樣是孤立動作時,要選在拉長位置有張力的那個:
  // 二頭只有啞鈴時,上斜彎舉(拉長)應排在一般彎舉之前
  const armPlan = A.buildPlan({days:2, experience:'intermediate', equipment:['dumbbell'],
    minutes:120, warmup:true, stretch:true});
  const firstBiceps = armPlan[0].items.filter(i => i.id && i.g === 'biceps')[0];
  check(`同級動作優先選拉長位置的(二頭第一個排到「${firstBiceps ? firstBiceps.n : '無'}」)`,
    firstBiceps && firstBiceps.id === 'incline_curl');
}

/* ---- 3. 新手不該拿到先決條件太高的動作 ---- */
const A2 = globalThis.__api;
const hardIds = A2.EX.filter(e => e.hard).map(e => e.id);
let begOk = true, advHas = false;
for (const days of [1,2,3,4,5,6]) {
  for (const d of A2.buildPlan({days, experience:'beginner', equipment:['bodyweight','dumbbell','barbell','machine','cable','band','bar']}))
    if (d.items.some(i => hardIds.includes(i.id))) begOk = false;
  for (const d of A2.buildPlan({days, experience:'advanced', equipment:['bodyweight','bar']}))
    if (d.items.some(i => hardIds.includes(i.id))) advHas = true;
}
check('新手課表不含引體向上等進階動作', begOk);
check('進階者仍排得到這些動作', advHas);


/* ---- 4. 這些是實際跑過才會發現的:純函式測試抓不到的整合問題 ---- */

// 器材不足時,課表裡會有「這個部位排不出動作」的項目。那些項目沒有 rest,
// 一旦被算進時間裡就會變成 NaN,讓時間預算整個失效。
{
  let nanOk = true, nanMsg = '';
  for (const eq of [['bodyweight'], ['band'], ['bodyweight','band']])
    for (const mins of [30, 60, 120]) {
      const p = {days:3, experience:'beginner', equipment:eq, minutes:mins, warmup:true, stretch:true, age:30};
      for (const d of A.buildPlan(p)) {
        if (!Number.isFinite(d.minutes)) { nanOk = false; nanMsg = ` (${eq.join('+')}:minutes=${d.minutes})`; }
        const floorReached = new Set(d.items.filter(i=>i.id).map(i=>i.g)).size <= 3;
        if (Number.isFinite(d.minutes) && d.minutes > mins && !floorReached) {
          nanOk = false; nanMsg = ` (${eq.join('+')}/${mins}分 → ${d.minutes}分,沒有守住預算)`;
        }
      }
    }
  check('器材不足、有練不到的部位時,時間計算仍然正確' + nanMsg, nanOk);
}

// 目標體脂填在極端值時不能算出無限大的週數
{
  const p = {sex:'male', age:30, height:175, weight:80, bodyfat:20, activity:'light'};
  let bfOk = true, bfMsg = '';
  for (const goal of ['cut','bulk'])
    for (const pace of Object.keys(A.GOAL[goal].paces))
      for (const t of [5, 8, 12, 18, 25, 35, 39, 40, 41, 45]) {
        const b = A.bfPlan({...p, goal, pace, targetBf:t});
        if (!b) continue;
        if (b.mismatch || b.unrealistic) continue;
        if (!Number.isFinite(b.weeks) || !Number.isFinite(b.goalW) || b.goalW <= 0 || b.weeks > 500) {
          bfOk = false; bfMsg = ` (${goal}/${pace}/目標${t}%:${b.goalW}kg ${b.weeks}週)`;
        }
      }
  check('極端的目標體脂不會算出無限大或負數' + bfMsg, bfOk);
  check('不切實際的目標會被標記並說明',
    A.bfPlan({...p, goal:'bulk', pace:'fast', targetBf:39}).unrealistic === true && /不切實際|太大/.test(html));
}

// 課表頁顯示的 RIR 要和課表裡動作的 RIR 一致(年齡調整過的那個)
{
  let rirOk = true;
  for (const age of [16, 30, 70])
    for (const exp of Object.keys(A.EXP)) {
      const shown = A.ageAdjust(A.EXP[exp], age).rir;
      const plan = A.buildPlan({days:3, experience:exp, age, equipment:combos[2], minutes:90, warmup:true, stretch:true});
      const inPlan = plan[0].items.filter(i => i.id)[0].rir;
      if (shown.join() !== inPlan.join()) rirOk = false;
    }
  check('課表頁顯示的 RIR 與動作實際的 RIR 一致', rirOk && /ageAdjust\(EXP\[p\.experience\], p\.age\)\.rir/.test(html));
}

// 「套用熱量校正」按鈕:改過 weightTrend 的簽名後,這個 handler 一度傳錯參數、
// 按了完全沒反應。用假 DOM 實際點一次,確認寫進 localStorage 的值有變。
{
  const day = i => new Date(Date.now() - i*864e5).toISOString().slice(0,10);
  const weights = [];
  for (let i = 21; i >= 0; i--) weights.push({date:day(i), w:+(80 - 0.02*(21-i)).toFixed(1)});  // 掉太慢
  store['fitness.v1'] = JSON.stringify({
    profile:{sex:'male', age:30, height:175, weight:80, bodyfat:0, targetBf:0, kcalAdjust:0,
      experience:'intermediate', goal:'cut', pace:'std', focus:'balanced',
      days:4, minutes:75, equipment:FULL, warmup:true, stretch:true, activity:'light'},
    progress:{}, history:[], weights});
  for (const k of Object.keys(els)) delete els[k];
  new Function(code)();                       // 用這份資料重新啟動一次
  ['setup','plan','log','diet'].forEach(x => els[x] && (els[x].hidden = x !== 'diet'));
  tabs[3].onclick();
  const before = JSON.parse(store['fitness.v1']).profile.kcalAdjust;
  const hasBtn = !!els.w_apply && typeof els.w_apply.onclick === 'function';
  if (hasBtn) els.w_apply.onclick();
  const after = JSON.parse(store['fitness.v1']).profile.kcalAdjust;
  check('趨勢偏離時畫面上會出現「套用」按鈕', hasBtn);
  check(`按下套用會真的改變熱量校正值(${before} → ${after})`, hasBtn && after !== before && Math.abs(after - before) === 200);
}

// 舊版本存下來的資料(沒有 pace / focus / minutes / targetBf)要能直接載入
{
  store['fitness.v1'] = JSON.stringify({
    profile:{sex:'female', age:35, height:163, weight:58, experience:'beginner',
      goal:'cut', days:3, equipment:['bodyweight','dumbbell'], warmup:true, stretch:true, activity:'light'},
    progress:{db_bench:{weight:20, reps:[12,12,12], fail:0}}, history:[]});
  for (const k of Object.keys(els)) delete els[k];
  new Function(code)();
  let oldOk = true, oldMsg = '';
  for (const tab of ['plan','log','diet']) {
    ['setup','plan','log','diet'].forEach(x => els[x] && (els[x].hidden = x !== tab));
    tabs[['setup','plan','log','diet'].indexOf(tab)].onclick();
    const out = els[tab].innerHTML;
    if (out.length < 300 || /NaN|undefined/.test(out)) { oldOk = false; oldMsg = ` (${tab} 分頁)`; }
  }
  check('舊版本存的資料仍然載入得起來' + oldMsg, oldOk);
}

process.exit(failed ? 1 : 0);
