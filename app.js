/* =========================================================
   클래쯔피아노 공유 앱 로직 (app.js)

   ⚠️ 데모용 프로토타입입니다.
   회원가입/로그인/구매내역은 브라우저 localStorage에만 저장되며,
   비밀번호도 암호화 없이 저장됩니다. 실제 서비스로 전환할 때는
   아래 표시된 지점을 실제 백엔드(DB, 해시 처리, 세션/JWT, PG 웹훅)로
   교체해야 합니다.
   ========================================================= */
window.ClazzApp = (function(){

  /* ---------- DOM utilities ---------- */
  function $(sel, ctx){ return (ctx || document).querySelector(sel); }
  function $all(sel, ctx){ return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function showToast(msg){
    var toast = $('#toast');
    if(!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function(){ toast.classList.remove('show'); }, 2600);
  }

  function openModal(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.classList.remove('open');
    document.body.style.overflow = '';
  }

  function initModalDismiss(){
    $all('[data-close]').forEach(function(btn){
      btn.addEventListener('click', function(){ closeModal(btn.getAttribute('data-close')); });
    });
    $all('.modal-overlay').forEach(function(overlay){
      overlay.addEventListener('click', function(e){
        if(e.target === overlay) closeModal(overlay.id);
      });
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        $all('.modal-overlay.open').forEach(function(o){ closeModal(o.id); });
      }
    });
  }

  function money(n){ return n.toLocaleString('ko-KR') + '원'; }
  function moneyUSD(n){ return '$' + n.toFixed(2); }

  // 상품에 priceSchedule이 있으면 "할인 종료일(한국시간 자정 기준)"을 지났는지에 따라
  // KRW/USD 가격을 자동으로 골라줍니다. 없으면 그냥 기존 price/priceUSD를 그대로 씁니다.
  function currentPrice(item){
    if(!item.priceSchedule){
      return { krw: item.price, usd: item.priceUSD, onSale: false };
    }
    var s = item.priceSchedule;
    var cutoff = new Date(s.until + 'T23:59:59+09:00');
    var onSale = new Date() <= cutoff;
    return {
      krw: onSale ? s.krwBefore : s.krwAfter,
      usd: onSale ? s.usdBefore : s.usdAfter,
      onSale: onSale,
      until: s.until
    };
  }

  /* ---------- Language (site-wide, persisted) ---------- */
  var LS_LANG = 'cp_lang_v1';
  function getLang(){ return localStorage.getItem(LS_LANG) === 'en' ? 'en' : 'kr'; }
  function setLang(lang){ localStorage.setItem(LS_LANG, lang === 'en' ? 'en' : 'kr'); }

  // field can be a {kr,en} object or a plain string (returned as-is)
  function t(field){
    if(field == null) return '';
    if(typeof field === 'string') return field;
    var lang = getLang();
    return field[lang] || field.kr || '';
  }

  // Paints every [data-i18n] element from a dictionary of {key:{kr,en}}.
  // Elements with [data-i18n-html] get innerHTML (for line breaks); others get textContent.
  // Elements with [data-i18n-placeholder] get their placeholder translated from the same dict.
  function applyI18n(dict){
    var lang = getLang();
    $all('[data-i18n]').forEach(function(el){
      var entry = dict[el.getAttribute('data-i18n')];
      if(!entry || !entry[lang]) return;
      if(el.hasAttribute('data-i18n-html')) el.innerHTML = entry[lang];
      else el.textContent = entry[lang];
    });
    $all('[data-i18n-placeholder]').forEach(function(el){
      var entry = dict[el.getAttribute('data-i18n-placeholder')];
      if(entry && entry[lang]) el.placeholder = entry[lang];
    });
    document.documentElement.lang = lang === 'kr' ? 'ko' : 'en';
  }

  // Wires up a page's KR/EN toggle buttons (expects #langKr / #langEn in the header)
  // and re-applies i18n + calls back so the page can re-render any dynamic (catalog-driven) content.
  function initLangToggle(dict, onChange){
    var lang = getLang();
    var krBtn = $('#langKr'), enBtn = $('#langEn');
    function paint(){
      if(krBtn) krBtn.classList.toggle('active', getLang() === 'kr');
      if(enBtn) enBtn.classList.toggle('active', getLang() === 'en');
      applyI18n(dict);
      if(onChange) onChange(getLang());
    }
    if(krBtn) krBtn.addEventListener('click', function(){ setLang('kr'); paint(); });
    if(enBtn) enBtn.addEventListener('click', function(){ setLang('en'); paint(); });
    paint();
  }

  // Shared strings reused across every page's header/footer/common modals.
  var COMMON_I18N = {
    brandKr:{kr:'클래쯔피아노', en:'Clazz Piano'},
    navWorksheets:{kr:'워크지', en:'Worksheets'},
    navGames:{kr:'유료 게임', en:'Premium Games'},
    navSheetMusic:{kr:'악보+MR', en:'Sheet Music+MR'},
    footerInfoTitle:{kr:'사업자 정보', en:'Business Info'},
    footerInfoName:{kr:'상호 : 클래쯔피아노', en:'Name: Clazz Piano'},
    footerInfoCeo:{kr:'대표 : 최미현', en:'CEO: Choi Mi-hyun'},
    footerInfoBizNum:{kr:'사업자등록번호 : 384-91-01851', en:'Business Reg. No.: 384-91-01851'},
    footerInfoMailOrder:{kr:'통신판매업신고번호 : 2026-고양덕양구-2341호', en:'Mail Order Sales Business No.: 2026-Goyang Deogyang-gu-2341'},
    footerInfoAddress:{kr:'주소 : 경기도 덕양구 화신로 234, 백양빌딩 301호', en:'Address: 234 Hwasin-ro, Deogyang-gu, Gyeonggi-do, Room 301, Baekyang Bldg.'},
    footerInfoPhone:{kr:'전화 : 010-5929-6243', en:'Phone: 010-5929-6243'},
    footerInfoContact:{kr:'문의 : mihyun555@gmail.com', en:'Contact: mihyun555@gmail.com'},
    footerMoreTitle:{kr:'더보기', en:'More'},
    footerPricing:{kr:'구독 플랜', en:'Subscription plans'},
    footerTerms:{kr:'이용약관', en:'Terms of Service'},
    footerPrivacy:{kr:'개인정보처리방침', en:'Privacy Policy'},
    footerPatch:{kr:'패치노트', en:'Patch notes'},
    footerBug:{kr:'버그 제보', en:'Report a bug'},
    footerNote:{kr:'본 사이트는 데모 버전이며 일부 기능은 준비 중입니다.', en:'This site is a demo — some features are still in progress.'},
    footerDesc:{kr:'음악학원을 위한 수업자료를 만듭니다.<br><br>배움안에 즐거움과 행복이 함께하는 그 지점을 만들어가고 있어요.', en:'We make lesson materials for piano studios.<br><br>Building a place where joy and happiness live inside learning.'},
    backHome:{kr:'← 홈으로', en:'← Home'},
    payToss:{kr:'신용카드 결제', en:'Pay by credit card'},
    payPortone:{kr:'신용카드 결제 (예비 수단)', en:'Pay by credit card (backup)'},
    paySummaryLabel:{kr:'결제 금액', en:'Total'},
    payConfirm:{kr:'결제 진행', en:'Proceed to pay'},
    payProcessing:{kr:'결제를 진행하고 있어요. 잠시만 기다려 주세요.', en:'Processing your payment. One moment.'},
    bugTitle:{kr:'버그 제보', en:'Report a Bug'},
    bugSub:{kr:'발견하신 문제를 알려주시면 빠르게 확인할게요.', en:"Tell us what happened and we'll take a look."},
    bugName:{kr:'이름', en:'Name'},
    bugEmail:{kr:'이메일', en:'Email'},
    bugContent:{kr:'내용', en:'Details'},
    bugSubmit:{kr:'제보 보내기', en:'Send report'},
    patchTitle:{kr:'패치노트', en:'Patch Notes'},
    patchSub:{kr:'클래쯔피아노가 업데이트된 내역이에요.', en:"What's changed in Clazz Piano."}
  };

  function paintAuthNavLabel(){
    var link = document.getElementById('myPageLink');
    if(!link) return;
    var lang = getLang();
    var user = currentUser();
    if(user){
      link.textContent = (user.name || (lang === 'en' ? 'My Page' : '마이페이지')) + (lang === 'en' ? '' : '님');
    }else{
      link.textContent = lang === 'en' ? 'Log in / Sign up' : '로그인 / 회원가입';
    }
  }

  /* ---------- Product catalog (bilingual: use t(field) to read the active language) ---------- */
  // 실제 게임이 사이트에 연결되기 전까지는 비워둡니다 (게임 목록에 "Coming Soon" 표시).
  // 게임이 준비되면 아래 예시와 같은 형태로 GAMES 배열에 넣어주세요.
  // { id:'고유id', name:{kr:'...', en:'...'}, desc:{kr:'...', en:'...'}, price:5900,
  //   tags:{kr:['...'], en:['...']} }
  var GAMES = [
  ];

  // 실제 워크지/악보 파일이 Storage에 업로드되기 전까지는 비워둡니다.
  // 항목을 추가할 때는 아래 예시와 같은 형태로 WORKSHEETS/SHEET_MUSIC 배열에 넣어주세요.
  // 워크지 예시: { id:'고유id', category:'color'|'quiz'|'madeby', free:true|false, price:1500,
  //              name:{kr:'...', en:'...'}, desc:{kr:'...', en:'...'} }
  var WORKSHEETS = [
    { id:'color-vol-1', category:'color', free:true, name:{kr:'색칠VOL.1', en:'Coloring Vol.1'},
      desc:{kr:'오른손, 왼손을 복습하는 워크지예요.', en:'A worksheet reviewing right hand and left hand.'} },
    { id:'color-vol-2', category:'color', free:true, name:{kr:'색칠VOL.2', en:'Coloring Vol.2'},
      desc:{kr:'건반자리를 복습하는 워크지예요.', en:'A worksheet reviewing keyboard positions.'} },
    { id:'color-vol-3', category:'color', free:true, name:{kr:'색칠VOL.3', en:'Coloring Vol.3'},
      desc:{kr:'음표를 복습하는 워크지예요.', en:'A worksheet reviewing notes.'} },
    { id:'color-vol-4', category:'color', free:true, name:{kr:'색칠VOL.4', en:'Coloring Vol.4'},
      desc:{kr:'계이름(가온도자리, 낮은도자리)을 복습하는 워크지예요.', en:'A worksheet reviewing note names (middle C position, low C position).'} },
    { id:'color-vol-5', category:'color', free:true, name:{kr:'색칠VOL.5', en:'Coloring Vol.5'},
      desc:{kr:'차례가기, 건너가기를 복습하는 워크지예요.', en:'A worksheet reviewing steps and skips.'} },
    { id:'color-vol-6', category:'color', free:true, name:{kr:'색칠VOL.6', en:'Coloring Vol.6'},
      desc:{kr:'음정을 복습하는 픽셀 워크지예요.', en:'A pixel worksheet reviewing intervals.'} },
    { id:'color-vol-7', category:'color', free:true, name:{kr:'색칠VOL.7', en:'Coloring Vol.7'},
      desc:{kr:'계이름, 음정을 복습하는 워크지예요.', en:'A worksheet reviewing note names and intervals.'} },
    { id:'color-vol-8', category:'color', free:true, name:{kr:'색칠VOL.8', en:'Coloring Vol.8'},
      desc:{kr:'온음, 반음을 복습하는 워크지예요.', en:'A worksheet reviewing whole tones and half tones.'} },
    { id:'sudoku1', category:'quiz', free:false,
      name:{kr:'4×4 수도쿠 워크지', en:'4×4 Sudoku Worksheet'},
      desc:{kr:'4×4 수도쿠로 즐기는 워크지예요. 5가지 주제, 각 주제마다 쉬움·보통·어려움 3단계 난이도로 구성되어 있어서 7세부터 초등 3~4학년까지 폭넓게 사용하실 수 있어요.',
            en:'A 4×4 Sudoku worksheet set with five themes, each in three difficulty levels (easy, normal, challenge) — great for ages 7 through 3rd–4th grade.'},
      priceSchedule: { until:'2026-10-15', krwBefore:3900, krwAfter:4900, usdBefore:3.99, usdAfter:4.99 } }
  ];

  var WORKSHEET_CATEGORIES = [
    { id:'color', name:{kr:'색칠워크지', en:'Coloring'} },
    { id:'quiz', name:{kr:'퀴즈워크지', en:'Quiz'} },
    { id:'madeby', name:{kr:'made by 워크지', en:'Made by'} }
  ];

  var TIERS = [
    { id:'basic', name:{kr:'베이직', en:'Basic'}, price:9900, games:1, worksheets:5,
      desc:{kr:'게임 1개 이용권 + 워크지 5개 다운로드', en:'1 game pass + 5 worksheet downloads'} },
    { id:'standard', name:{kr:'스탠다드', en:'Standard'}, price:15900, games:2, worksheets:10,
      desc:{kr:'게임 2개 이용권 + 워크지 10개 다운로드', en:'2 game passes + 10 worksheet downloads'}, featured:true },
    { id:'premium', name:{kr:'프리미엄', en:'Premium'}, price:19900, games:3, worksheets:10,
      desc:{kr:'게임 3개 이용권 + 워크지 10개 다운로드', en:'3 game passes + 10 worksheet downloads'} }
  ];

  // 악보+MR 예시: { id:'고유id', category:'classical'|'fourhands'|'ost'|'performance'|'event', price:3000,
  //               name:{kr:'...', en:'...'}, desc:{kr:'...', en:'...'} }
  var SHEET_MUSIC = [
    { id:'xmas-we-wish-you', category:'christmas', price:2400, hasMr:false,
      name:{kr:'We wish you a merry Christmas', en:'We wish you a merry Christmas'},
      desc:{kr:'크리스마스 연주회나 미션곡으로 쓸 수 있도록 약간의 재즈 분위기를 넣은 only 피아노 연주곡이예요.',
            en:'A piano-only arrangement with a touch of jazz, perfect for a Christmas recital or as an assignment piece.'},
      youtubeUrl:'https://youtu.be/JXUduEV90Wg?si=pxRY2gjR6I6HDCJL' }
  ];

  var SHEET_MUSIC_CATEGORIES = [
    { id:'classical', name:{kr:'클래식', en:'Classical'} },
    { id:'fourhands', name:{kr:'포핸즈', en:'Four Hands'} },
    { id:'ost', name:{kr:'OST', en:'OST'} },
    { id:'performance', name:{kr:'연주곡', en:'Performance'} },
    { id:'christmas', name:{kr:'크리스마스', en:'Christmas'} },
    { id:'parentsday', name:{kr:'어버이날', en:"Parents' Day"} }
  ];

  // 카테고리에 상품이 아직 없을 때 보여줄 공통 "커밍순" 블록
  function comingSoonHTML(){
    var lang = getLang();
    var title = 'Coming Soon';
    var sub = lang === 'en' ? "We're preparing this category. Check back soon!" : '이 카테고리는 준비 중이에요. 곧 만나요!';
    return '<div class="empty-state">' +
      '<p style="font-family:\'Noto Serif KR\',serif;font-size:1.15rem;color:var(--green);font-weight:700;margin-bottom:4px;">' + title + '</p>' +
      '<p>' + sub + '</p>' +
      '</div>';
  }

  function findGame(id){ return GAMES.filter(function(g){ return g.id === id; })[0] || null; }
  function findWorksheet(id){ return WORKSHEETS.filter(function(w){ return w.id === id; })[0] || null; }
  function findTier(id){ return TIERS.filter(function(t){ return t.id === id; })[0] || null; }
  function findSheetMusic(id){ return SHEET_MUSIC.filter(function(s){ return s.id === id; })[0] || null; }

  /* =========================================================
     Firebase 연동
     - Authentication: 이메일/비밀번호 기반. 로그인 화면은 "아이디"를 쓰므로
       'usernames/{username}' 문서에 {uid, email}을 저장해두고, 로그인 시
       아이디→이메일을 조회한 뒤 실제로는 이메일로 로그인합니다.
     - Firestore: users/{uid} - 회원 정보, entitlements/{uid} - 구매/구독 내역
     - 화면 코드(worksheets.html 등)는 예전처럼 동기 함수처럼 쓸 수 있도록,
       로그인 상태가 확정된 뒤의 값을 메모리에 캐시해두고 그 캐시를 읽습니다.
       (읽기: 캐시에서 즉시 반환 / 쓰기: 캐시를 먼저 갱신하고 Firestore에는 비동기로 저장)
     ========================================================= */
  var firebaseConfig = {
    apiKey: "AIzaSyDbFs3gyByr6wpKtSK6EhMgNBgyg-9a7jA",
    authDomain: "clazzpiano-5bd10.firebaseapp.com",
    projectId: "clazzpiano-5bd10",
    storageBucket: "clazzpiano-5bd10.firebasestorage.app",
    messagingSenderId: "21206093317",
    appId: "1:21206093317:web:8d49ac31483e1a9855d66c",
    measurementId: "G-G9KMJF3REW"
  };
  firebase.initializeApp(firebaseConfig);
  var fbAuth = firebase.auth();
  var db = firebase.firestore();

  function defaultEnt(){
    return {
      ownedGameIds: [],
      paidWorksheetIds: [],
      ownedSheetMusicIds: [],
      worksheetCredits: 0,
      gameSlotsTotal: 0,
      gameSlotsUsed: 0,
      subscription: null,
      purchaseHistory: [],
      freeDownloads: []
    };
  }

  var CURRENT_USER_DOC = null;   // {uid, username, memberType, name, phone, email, businessName, businessAddress, businessNumber, createdAt}
  var CURRENT_ENT = null;        // defaultEnt() 형태
  var authReady = false;
  var readyQueue = [];

  // 로그인 상태(및 회원정보/구매내역 로딩)가 확정된 뒤 호출되는 콜백을 등록합니다.
  // 각 페이지 스크립트는 반드시 ClazzApp.onReady(...) 안에서 첫 렌더링을 시작해야 해요.
  function onReady(cb){
    if(authReady) cb();
    else readyQueue.push(cb);
  }

  fbAuth.onAuthStateChanged(function(fbUser){
    if(!fbUser){
      CURRENT_USER_DOC = null;
      CURRENT_ENT = null;
      authReady = true;
      readyQueue.forEach(function(cb){ cb(); });
      readyQueue = [];
      return;
    }
    Promise.all([
      db.collection('users').doc(fbUser.uid).get(),
      db.collection('entitlements').doc(fbUser.uid).get()
    ]).then(function(results){
      CURRENT_USER_DOC = results[0].exists ? results[0].data() : null;
      CURRENT_ENT = results[1].exists ? results[1].data() : defaultEnt();
    }).catch(function(err){
      console.error('클래쯔피아노: 회원/구매 정보를 불러오지 못했어요.', err);
      CURRENT_USER_DOC = null;
      CURRENT_ENT = null;
    }).then(function(){
      authReady = true;
      readyQueue.forEach(function(cb){ cb(); });
      readyQueue = [];
    });
  });

  function isLoggedIn(){ return !!CURRENT_USER_DOC; }
  function currentUser(){ return CURRENT_USER_DOC; }
  function currentUsername(){ return CURRENT_USER_DOC ? CURRENT_USER_DOC.username : null; }

  // payload: { memberType:'individual'|'director', username, password, name, phone, email,
  //            businessName, businessAddress, businessNumber }
  // 반환값: Promise<{ok, error}>  — error: 'missing' | 'exists' | 'email-taken' | 'weak-password' | 'unknown'
  function signUp(payload){
    payload = payload || {};
    var username = (payload.username || '').trim();
    var memberType = payload.memberType === 'director' ? 'director' : 'individual';

    var required = ['username', 'password', 'name', 'phone', 'email'];
    if(memberType === 'director'){
      required = required.concat(['businessName', 'businessAddress', 'businessNumber']);
    }
    for(var i=0; i<required.length; i++){
      if(!payload[required[i]] || !String(payload[required[i]]).trim()){
        return Promise.resolve({ok:false, error:'missing'});
      }
    }
    var email = payload.email.trim();

    return db.collection('usernames').doc(username).get().then(function(snap){
      if(snap.exists) return {ok:false, error:'exists'};

      return fbAuth.createUserWithEmailAndPassword(email, payload.password).then(function(cred){
        var uid = cred.user.uid;
        var userDoc = {
          uid: uid,
          username: username,
          memberType: memberType,
          name: payload.name,
          phone: payload.phone,
          email: email,
          businessName: payload.businessName || '',
          businessAddress: payload.businessAddress || '',
          businessNumber: payload.businessNumber || '',
          createdAt: new Date().toISOString()
        };
        var ent = defaultEnt();
        return Promise.all([
          db.collection('users').doc(uid).set(userDoc),
          db.collection('usernames').doc(username).set({uid:uid, email:email}),
          db.collection('entitlements').doc(uid).set(ent)
        ]).then(function(){
          CURRENT_USER_DOC = userDoc;
          CURRENT_ENT = ent;
          return {ok:true};
        });
      }).catch(function(err){
        if(err.code === 'auth/email-already-in-use') return {ok:false, error:'email-taken'};
        if(err.code === 'auth/weak-password') return {ok:false, error:'weak-password'};
        console.error('클래쯔피아노: 회원가입 실패', err);
        return {ok:false, error:'unknown'};
      });
    });
  }

  // 반환값: Promise<{ok, error}> — error: 'invalid'
  function logIn(username, password){
    username = (username || '').trim();
    return db.collection('usernames').doc(username).get().then(function(snap){
      if(!snap.exists) return {ok:false, error:'invalid'};
      var email = snap.data().email;
      return fbAuth.signInWithEmailAndPassword(email, password).then(function(){
        return {ok:true};
      }).catch(function(){
        return {ok:false, error:'invalid'};
      });
    });
  }

  function logOut(){ return fbAuth.signOut(); }

  // 반환값: Promise<boolean>
  function isUsernameTaken(username){
    username = (username || '').trim();
    if(!username) return Promise.resolve(false);
    return db.collection('usernames').doc(username).get().then(function(snap){ return snap.exists; });
  }

  function requireLogin(nextUrl){
    var target = nextUrl || (window.location.pathname + window.location.search);
    window.location.href = 'account.html?redirect=' + encodeURIComponent(target);
  }

  /* ---------- Entitlements (읽기: 캐시 즉시 반환 / 쓰기: 캐시 갱신 + Firestore 비동기 저장) ---------- */
  function getEnt(){ return CURRENT_ENT || defaultEnt(); }

  function persistEnt(){
    if(!CURRENT_USER_DOC || !CURRENT_ENT) return;
    db.collection('entitlements').doc(CURRENT_USER_DOC.uid).set(CURRENT_ENT).catch(function(err){
      console.error('클래쯔피아노: 구매내역 저장 실패', err);
    });
  }

  function hasGameAccess(gameId){
    return isLoggedIn() && getEnt().ownedGameIds.indexOf(gameId) > -1;
  }
  function hasWorksheetAccess(sheet){
    if(sheet.free) return isLoggedIn();
    return isLoggedIn() && getEnt().paidWorksheetIds.indexOf(sheet.id) > -1;
  }
  function hasSheetMusicAccess(item){
    return isLoggedIn() && (getEnt().ownedSheetMusicIds || []).indexOf(item.id) > -1;
  }

  function grantSheetMusicPurchase(sheetMusicId, price){
    if(!isLoggedIn()) return;
    var ent = getEnt();
    if(!ent.ownedSheetMusicIds) ent.ownedSheetMusicIds = [];
    if(ent.ownedSheetMusicIds.indexOf(sheetMusicId) === -1) ent.ownedSheetMusicIds.push(sheetMusicId);
    ent.purchaseHistory.unshift({kind:'sheetmusic', refId:sheetMusicId, price:price, date:new Date().toISOString()});
    persistEnt();
  }

  function grantGamePurchase(gameId, price){
    if(!isLoggedIn()) return;
    var ent = getEnt();
    if(ent.ownedGameIds.indexOf(gameId) === -1) ent.ownedGameIds.push(gameId);
    ent.purchaseHistory.unshift({kind:'game', refId:gameId, price:price, date:new Date().toISOString()});
    persistEnt();
  }

  function useGameSlot(gameId){
    if(!isLoggedIn()) return {ok:false, error:'no-login'};
    var ent = getEnt();
    if(ent.ownedGameIds.indexOf(gameId) > -1) return {ok:true, already:true};
    if(!ent.subscription || ent.gameSlotsUsed >= ent.gameSlotsTotal) return {ok:false, error:'no-slots'};
    ent.gameSlotsUsed += 1;
    ent.ownedGameIds.push(gameId);
    ent.purchaseHistory.unshift({kind:'game-slot', refId:gameId, price:0, date:new Date().toISOString()});
    persistEnt();
    return {ok:true};
  }

  function grantWorksheetPurchase(sheetId, price){
    if(!isLoggedIn()) return;
    var ent = getEnt();
    if(ent.paidWorksheetIds.indexOf(sheetId) === -1) ent.paidWorksheetIds.push(sheetId);
    ent.purchaseHistory.unshift({kind:'worksheet', refId:sheetId, price:price, date:new Date().toISOString()});
    persistEnt();
  }

  function useWorksheetCredit(sheetId){
    if(!isLoggedIn()) return {ok:false, error:'no-login'};
    var ent = getEnt();
    if(ent.paidWorksheetIds.indexOf(sheetId) > -1) return {ok:true, already:true};
    if(ent.worksheetCredits <= 0) return {ok:false, error:'no-credit'};
    ent.worksheetCredits -= 1;
    ent.paidWorksheetIds.push(sheetId);
    ent.purchaseHistory.unshift({kind:'worksheet-credit', refId:sheetId, price:0, date:new Date().toISOString()});
    persistEnt();
    return {ok:true};
  }

  function logFreeDownload(sheetId){
    if(!isLoggedIn()) return;
    var ent = getEnt();
    ent.freeDownloads.unshift({refId:sheetId, date:new Date().toISOString()});
    persistEnt();
  }

  function subscribeTier(tierId){
    if(!isLoggedIn()) return {ok:false, error:'no-login'};
    var tier = findTier(tierId);
    if(!tier) return {ok:false, error:'no-tier'};
    var ent = getEnt();
    var now = new Date();
    var renews = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    ent.subscription = {
      tierId: tier.id,
      price: tier.price,
      purchasedAt: now.toISOString(),
      renewsOn: renews.toISOString()
    };
    ent.gameSlotsTotal = tier.games;
    ent.gameSlotsUsed = 0;
    ent.worksheetCredits = (ent.worksheetCredits || 0) + tier.worksheets;
    ent.purchaseHistory.unshift({kind:'subscription', refId:tier.id, price:tier.price, date: now.toISOString()});
    persistEnt();
    return {ok:true};
  }

  // Resolves a stored (language-independent) history/subscription entry into
  // display text in the currently active language.
  var HISTORY_KIND_LABEL = {
    'game': {kr:'게임 단품 구매', en:'Game purchase'},
    'game-slot': {kr:'구독 게임 슬롯 사용', en:'Subscription game slot'},
    'worksheet': {kr:'워크지 단품 구매', en:'Worksheet purchase'},
    'worksheet-credit': {kr:'구독 크레딧으로 다운로드', en:'Downloaded with subscription credit'},
    'sheetmusic': {kr:'악보+MR 구매', en:'Sheet music + MR purchase'},
    'subscription': {kr:'구독 결제', en:'Subscription payment'}
  };
  function historyItemLabel(item){
    var kindLabel = t(HISTORY_KIND_LABEL[item.kind]) || item.kind;
    var refLabel = item.refId;
    if(item.kind === 'game' || item.kind === 'game-slot'){
      var g = findGame(item.refId); if(g) refLabel = t(g.name);
    }else if(item.kind === 'worksheet' || item.kind === 'worksheet-credit'){
      var w = findWorksheet(item.refId); if(w) refLabel = t(w.name);
    }else if(item.kind === 'sheetmusic'){
      var sm = findSheetMusic(item.refId); if(sm) refLabel = t(sm.name);
    }else if(item.kind === 'subscription'){
      var tr = findTier(item.refId); if(tr) refLabel = t(tr.name);
    }
    return kindLabel + ' · ' + refLabel;
  }
  function freeDownloadLabel(item){
    var w = findWorksheet(item.refId);
    var prefix = getLang() === 'en' ? 'Free download' : '무료 다운로드';
    return prefix + ' · ' + (w ? t(w.name) : item.refId);
  }
  function tierDisplayName(tierId){
    var tr = findTier(tierId);
    return tr ? t(tr.name) : tierId;
  }

  /* =========================================================
     결제 시뮬레이션 엔진
     실제 PG(토스페이먼츠 / 포트원) 연동 시 startPayment() 내부의
     시뮬레이션 부분을 실제 SDK 호출로 교체하고,
     PG의 결제 성공 콜백에서 완료 콜백(onSuccess)을 그대로 호출하면 됩니다.
     정기결제(구독)는 PG가 발급하는 빌링키를 서버에 저장해두고
     서버 스케줄러(cron)가 매달 재청구를 실행해야 하며,
     이 부분은 브라우저 JS만으로는 안전하게 구현할 수 없습니다.
     ========================================================= */
  var IMP_STORE_CODE = 'imp47257084';

  function openPaymentFlow(product, onSuccess){
    var titleEl = $('#payTitleText');
    var subEl = $('#paySubText');
    var amountEl = $('#payAmountText');
    var lang = getLang();
    if(titleEl) titleEl.textContent = lang === 'en' ? 'Choose a payment method' : '결제 수단 선택';
    if(subEl) subEl.textContent = t(product.name);
    if(amountEl) amountEl.textContent = money(product.price);

    $('#payStepMethod') && $('#payStepMethod').classList.add('active');
    $('#payStepProcessing') && $('#payStepProcessing').classList.remove('active');
    openModal('paymentModal');

    $all('.pay-method').forEach(function(label){
      label.onclick = function(){
        $all('.pay-method').forEach(function(l){ l.classList.remove('selected'); });
        label.classList.add('selected');
      };
    });

    var confirmBtn = $('#confirmPayBtn');
    if(confirmBtn){
      confirmBtn.onclick = function(){
        $('#payStepMethod').classList.remove('active');
        $('#payStepProcessing').classList.add('active');

        var selectedMethod = document.querySelector('input[name="payMethod"]:checked');
        // ⚠️ 지금은 "테스트" 채널(KG이니시스, MID: INIpayTest) 하나만 만들어져 있어서
        // 이 코드를 그대로 씁니다. 나중에 KCP/KG이니시스 실연동(카드사 심사 통과) 채널이
        // 생기면, 그때 실제 채널에 맞는 pg 값으로 바꿔드릴게요.
        var pgCode = 'html5_inicis.INIpayTest';
        // ⚠️ pgCode: 포트원 콘솔의 "채널 관리"에 등록된 실제 채널 식별자와 다를 수 있어요.
        // 결제창이 안 뜨거나 오류가 나면, 포트원 관리자 콘솔 > 채널 관리에서 정확한 값을 확인해서 알려주세요.

        var merchantUid = 'clazzpiano_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        var user = currentUser();

        if(typeof IMP === 'undefined'){
          $('#payStepProcessing').classList.remove('active');
          $('#payStepMethod').classList.add('active');
          showToast(lang === 'en' ? 'Payment module failed to load. Please refresh and try again.' : '결제 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
          return;
        }

        IMP.init(IMP_STORE_CODE);
        IMP.request_pay({
          pg: pgCode,
          pay_method: 'card',
          merchant_uid: merchantUid,
          name: t(product.name),
          amount: product.price,
          buyer_email: user ? user.email : '',
          buyer_name: user ? user.name : ''
        }, function(rsp){
          if(!rsp.success){
            $('#payStepProcessing').classList.remove('active');
            $('#payStepMethod').classList.add('active');
            showToast(rsp.error_msg || (lang === 'en' ? 'Payment was cancelled.' : '결제가 취소됐어요.'));
            return;
          }

          // 브라우저가 "성공했다"고 말하는 걸 그대로 믿지 않고, 서버(Cloud Functions)가
          // 포트원에 직접 물어봐서 실제 결제/금액을 확인한 뒤에만 구매를 확정합니다.
          var verifyPayment = fbFunctions.httpsCallable('verifyPayment');
          verifyPayment({
            impUid: rsp.imp_uid,
            expectedAmount: product.price,
            productType: product.type,
            productId: product.id
          }).then(function(){
            return refreshEntitlements();
          }).then(function(){
            closeModal('paymentModal');
            showToast(lang === 'en' ? 'Payment complete.' : '결제가 완료됐어요.');
            onSuccess();
          }).catch(function(err){
            console.error('클래쯔피아노: 결제 검증 실패', err);
            closeModal('paymentModal');
            showToast(lang === 'en'
              ? 'Payment could not be verified. Please contact support.'
              : '결제 확인에 실패했어요. 카드사에서 실제로 결제가 됐다면 문의(mihyun555@gmail.com)로 연락해주세요.');
          });
        });
      };
    }
  }

  /* ---------- Game player (placeholder stage) ---------- */
  function launchGame(product){
    var lang = getLang();
    var titleEl = $('#playerTitle');
    if(titleEl) titleEl.textContent = t(product.name);
    var stage = $('#playerStage');
    if(stage){
      stage.innerHTML = '<div class="spinner"></div><p>' + (lang === 'en' ? 'Loading the game.' : '게임을 불러오는 중입니다.') + '</p>';
    }
    openModal('gamePlayerModal');
    setTimeout(function(){
      if(!stage) return;
      stage.innerHTML = lang === 'en'
        ? '<p style="font-family:\'Noto Serif KR\',serif;font-size:1.1rem;color:#F3EFE6;">You\'re in — no password needed.</p><p>This is a placeholder stage for the real game player, shown automatically once payment and login are confirmed.</p>'
        : '<p style="font-family:\'Noto Serif KR\',serif;font-size:1.1rem;color:#F3EFE6;">비밀번호 입력 없이 바로 입장했어요.</p><p>이 자리는 실제 게임 플레이어가 들어갈 자리예요. 결제·로그인 확인 후 이 화면으로 자동 전환됩니다.</p>';
    }, 1100);
  }

  /* ---------- Free worksheet download (placeholder PDF) ---------- */
  var fbStorage = firebase.storage();
  var fbFunctions = firebase.functions();

  // 결제 검증 함수(Cloud Functions)가 서버에서 이미 Firestore를 갱신했으므로,
  // 여기서는 최신 상태를 다시 읽어와 화면용 캐시(CURRENT_ENT)만 새로고침합니다.
  function refreshEntitlements(){
    if(!CURRENT_USER_DOC) return Promise.resolve();
    return db.collection('entitlements').doc(CURRENT_USER_DOC.uid).get().then(function(snap){
      CURRENT_ENT = snap.exists ? snap.data() : defaultEnt();
    });
  }

  // Storage 경로 규칙: worksheets/free/{id}.pdf, worksheets/paid/{id}.pdf, sheetmusic/{id}.pdf (MR 음원은 {id}-mr.mp3)
  function worksheetStoragePath(sheet){
    var lang = getLang();
    return 'worksheets/' + (sheet.free ? 'free' : 'paid') + '/' + sheet.id + '/' + sheet.id + '-' + lang + '.pdf';
  }
  function sheetMusicPdfPath(item){ return 'sheetmusic/' + item.id + '/' + item.id + '.pdf'; }
  function sheetMusicMrPath(item){ return 'sheetmusic/' + item.id + '/' + item.id + '-mr.mp3'; }

  /* ---------- 악보 상세 미리보기 모달 (설명 + 유튜브 연주영상) ---------- */
  function extractYoutubeId(url){
    if(!url) return null;
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
    return m ? m[1] : null;
  }

  function ensureSheetMusicPreviewModal(){
    if(document.getElementById('sheetMusicPreviewModal')) return;
    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'sheetMusicPreviewModal';
    modal.setAttribute('role', 'dialog');
    modal.innerHTML =
      '<div class="modal-box wide">' +
        '<button class="modal-close" data-close="sheetMusicPreviewModal">&times;</button>' +
        '<h3 id="smpTitle" style="margin-bottom:10px;"></h3>' +
        '<p class="modal-sub" id="smpDesc" style="margin-bottom:18px;"></p>' +
        '<div id="smpVideoWrap"></div>' +
      '</div>';
    document.body.appendChild(modal);
    initModalDismiss();
  }

  function openSheetMusicPreview(item){
    ensureSheetMusicPreviewModal();
    $('#smpTitle').textContent = t(item.name);
    $('#smpDesc').textContent = t(item.desc);
    var videoWrap = $('#smpVideoWrap');
    var vid = extractYoutubeId(item.youtubeUrl);
    if(vid){
      videoWrap.innerHTML =
        '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;">' +
          '<iframe src="https://www.youtube.com/embed/' + vid + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe>' +
        '</div>';
    }else{
      var lang = getLang();
      videoWrap.innerHTML = '<p style="color:var(--ink-soft);font-size:0.85rem;">' +
        (lang === 'en' ? 'A preview video will be added here soon.' : '연주 영상은 곧 준비될 예정이에요.') + '</p>';
    }
    openModal('sheetMusicPreviewModal');
  }

  // 실제 Storage에 올라간 파일을 새 탭으로 열어 다운로드합니다.
  // 파일이 아직 안 올라와 있으면(storage/object-not-found) 안내 토스트를 보여줍니다.
  function downloadStorageFile(path, displayLabel){
    var lang = getLang();
    fbStorage.ref(path).getDownloadURL().then(function(url){
      window.open(url, '_blank');
    }).catch(function(err){
      if(err.code === 'storage/object-not-found'){
        showToast(lang === 'en'
          ? (displayLabel || 'This file') + ' is not uploaded yet.'
          : (displayLabel || '이 파일') + '은(는) 아직 업로드되지 않았어요.');
      }else{
        console.error('클래쯔피아노: 파일 다운로드 실패', err);
        showToast(lang === 'en' ? 'Could not download the file.' : '파일을 불러오지 못했어요.');
      }
    });
  }

  // 하위 호환용 — 예전 placeholder 다운로드 함수 이름은 그대로 두되, 내부적으로는 안내만 띄웁니다.
  function downloadWorksheetFile(filename){
    showToast(getLang() === 'en' ? 'Please use the updated download button.' : '다운로드 버튼을 새로고침 후 다시 눌러주세요.');
  }

  function formatDate(iso){
    try{
      var d = new Date(iso);
      return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0');
    }catch(e){ return ''; }
  }

  return {
    $:$, $all:$all, showToast:showToast, openModal:openModal, closeModal:closeModal,
    initModalDismiss:initModalDismiss, money:money, moneyUSD:moneyUSD, currentPrice:currentPrice, formatDate:formatDate,

    getLang:getLang, setLang:setLang, t:t, applyI18n:applyI18n,
    initLangToggle:initLangToggle, COMMON_I18N:COMMON_I18N,

    GAMES:GAMES, WORKSHEETS:WORKSHEETS, TIERS:TIERS, SHEET_MUSIC:SHEET_MUSIC,
    WORKSHEET_CATEGORIES:WORKSHEET_CATEGORIES, SHEET_MUSIC_CATEGORIES:SHEET_MUSIC_CATEGORIES,
    comingSoonHTML:comingSoonHTML,
    findGame:findGame, findWorksheet:findWorksheet, findTier:findTier, findSheetMusic:findSheetMusic,

    signUp:signUp, logIn:logIn, logOut:logOut,
    currentUser:currentUser, currentUsername:currentUsername, isLoggedIn:isLoggedIn,
    isUsernameTaken:isUsernameTaken,
    requireLogin:requireLogin, paintAuthNav:paintAuthNavLabel,

    getEnt:getEnt, onReady:onReady,
    hasGameAccess:hasGameAccess, hasWorksheetAccess:hasWorksheetAccess, hasSheetMusicAccess:hasSheetMusicAccess,
    grantGamePurchase:grantGamePurchase, useGameSlot:useGameSlot,
    grantWorksheetPurchase:grantWorksheetPurchase, useWorksheetCredit:useWorksheetCredit,
    grantSheetMusicPurchase:grantSheetMusicPurchase,
    logFreeDownload:logFreeDownload, subscribeTier:subscribeTier,
    historyItemLabel:historyItemLabel, freeDownloadLabel:freeDownloadLabel, tierDisplayName:tierDisplayName,

    openPaymentFlow:openPaymentFlow, launchGame:launchGame,
    downloadWorksheetFile:downloadWorksheetFile,
    downloadStorageFile:downloadStorageFile,
    openSheetMusicPreview:openSheetMusicPreview,
    worksheetStoragePath:worksheetStoragePath,
    sheetMusicPdfPath:sheetMusicPdfPath,
    sheetMusicMrPath:sheetMusicMrPath
  };
})();
