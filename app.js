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

  // 영어 화면에서는 priceUSD 가 있는 상품을 달러로 보여주고 달러로 결제해요.
  // 반환: { amount, currency:'KRW'|'USD', label }
  function labPrice(item){
    if(getLang() === 'en' && item.priceUSD){
      return { amount:item.priceUSD, currency:'USD', label:'$' + item.priceUSD.toFixed(2) };
    }
    return { amount:item.price, currency:'KRW', label:money(item.price) };
  }
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
    navGames:{kr:'클래쯔 뮤직랩', en:'Clazz Music Lab'},
    labTagline:{kr:'음악을 직접 느끼며 배우는 디지털 교구', en:'Digital learning tools for feeling music firsthand'},
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
    footerDesc:{kr:'음악학원을 위한 수업자료를 만듭니다.<br><br>배움안에 즐거움과 행복이 함께하는 그 지점을 만들어가고 있어요.', en:'We make lesson materials for piano studios.<br><br>Building a place where joy and happiness live inside learning.'},
    backHome:{kr:'← 홈으로', en:'← Home'},
    payToss:{kr:'신용카드 결제', en:'Pay by credit card'},
    paySubMethod:{kr:'신용카드 정기결제 등록', en:'Register a card for monthly billing'},
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
  // 새 교구를 추가할 때는 아래 계이름 브레인과 같은 형태로 넣어주세요.
  // ⚠️ 가격을 바꾸면 서버(functions/subscription.js)의 PRODUCTS 가격도 똑같이 바꿔야 해요.
  // 클래쯔 뮤직랩(디지털 교구) 상품 목록 — 변수 이름은 기존 코드 호환을 위해 GAMES 그대로 둡니다.
  // billing:'monthly' 인 상품은 매월 자동결제(정기결제)로 판매돼요.
  // url: 실제 교구 페이지 주소(비워두면 '준비 중' 화면이 떠요)
  var GAMES = [
    { id:'note-brain', billing:'monthly', price:3900, priceUSD:3.99, url:{kr:'note-brain.html', en:'note-brain-en.html'}, thumb:'note-brain-thumb.jpg',
      kind:{kr:'계이름 트레이닝 교구', en:'Note-reading training tool'},
      name:{kr:'계이름 브레인', en:'Solfège Brain'},
      desc:{kr:'큰보표 옆으로 흘러오는 음표를 보고 박자에 맞춰 도레미파솔라시 버튼을 누르며 계이름을 익히는 교구예요. 음자리 범위와 덧줄, 박자, 빠르기를 아이 수준에 맞게 고를 수 있어요.',
            en:'Notes flow sideways along the grand staff and children tap Do-Re-Mi buttons in time to name them. Choose the note range, ledger lines, meter and tempo to fit each child.'},
      tags:{kr:['높은음·낮은음자리표', '음자리 범위 5단계', '빠르기 3단계'], en:['Treble & bass clef', '5 note ranges', '3 tempos']} }
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
      desc:{kr:'뮤직랩 교구 1개 + 워크지 5개 다운로드', en:'1 Music Lab tool + 5 worksheet downloads'} },
    { id:'standard', name:{kr:'스탠다드', en:'Standard'}, price:15900, games:2, worksheets:10,
      desc:{kr:'뮤직랩 교구 2개 + 워크지 10개 다운로드', en:'2 Music Lab tools + 10 worksheet downloads'}, featured:true },
    { id:'premium', name:{kr:'프리미엄', en:'Premium'}, price:19900, games:3, worksheets:10,
      desc:{kr:'뮤직랩 교구 3개 + 워크지 10개 다운로드', en:'3 Music Lab tools + 10 worksheet downloads'} }
  ];

  // 악보+MR 예시: { id:'고유id', category:'classical'|'fourhands'|'ost'|'performance'|'event', price:3000,
  //               name:{kr:'...', en:'...'}, desc:{kr:'...', en:'...'} }
  var SHEET_MUSIC = [
    { id:'xmas-we-wish-you', category:'christmas', price:2400, hasMr:false,
      name:{kr:'We wish you a merry Christmas', en:'We wish you a merry Christmas'},
      desc:{kr:'크리스마스 연주회나 미션곡으로 쓸 수 있도록 약간의 재즈 분위기를 넣은 only 피아노 연주곡이예요.',
            en:'A piano-only arrangement with a touch of jazz, perfect for a Christmas recital or as an assignment piece.'},
      youtubeUrl:'https://youtu.be/JXUduEV90Wg?si=pxRY2gjR6I6HDCJL' },
    { id:'tchaikovsky-concerto-1', category:'classical', price:6900, hasMr:false,
      youtubeUrl:'https://youtu.be/AqrNZo6yyCA?si=c0qH14uHMbxpyNlw',
      level:{kr:'최상', en:'Expert'},
      instrument:{kr:'피아노 솔로', en:'Piano solo'},
      name:{kr:'차이코프스키 피아노 협주곡 1번 1악장', en:'Tchaikovsky Piano Concerto No. 1, 1st Movement'},
      desc:{kr:'차이코프스키 피아노 협주곡 1번 1악장의 유명한 테마를 C 메이저(다장조)로 조바꿈하여 짧고 부담 없는 길이로 편곡한 솔로 피아노 버전입니다.\n\n원곡 오케스트라의 웅장하고 드라마틱한 정수를 그대로 담아내면서, 피아노 솔로 연주에 적합한 길이로 구성했습니다. 간결한 악보 안에서 풍부한 임시표와 위대한 클래식 테마를 경험할 수 있습니다.\n\n감정 표현과 강약 조절을 연습하기 위한 미션곡으로 훌륭하며, 연주회, 작은 음악회, 스튜디오 발표회용으로 좋습니다.',
            en:'A solo piano arrangement of the famous theme from the first movement of Tchaikovsky\'s Piano Concerto No. 1, transposed to C major and shortened to a comfortable length.\n\nIt keeps the grand, dramatic essence of the original orchestral work while fitting the length of a piano solo. Within a concise score, students experience rich accidentals and one of the great classical themes.\n\nAn excellent assignment piece for practicing expression and dynamics, and a great choice for recitals, small concerts and studio performances.'} }
  ];

  var SHEET_MUSIC_CATEGORIES = [
    { id:'classical', name:{kr:'클래식', en:'Classical'} },
    { id:'fourhands', name:{kr:'포핸즈', en:'Four Hands'} },
    { id:'ost', name:{kr:'OST', en:'OST'} },
    { id:'performance', name:{kr:'연주곡', en:'Performance'} },
    { id:'christmas', name:{kr:'크리스마스', en:'Christmas'} },
    { id:'parentsday', name:{kr:'어버이날', en:"Parents' Day"} }
  ];

  // 악보 카드에 난이도·악기 정보를 작은 태그로 보여줘요 (level/instrument 가 있는 악보만)
  function sheetMusicMetaHTML(item){
    var lang = getLang();
    var tags = [];
    if(item.level) tags.push((lang === 'en' ? 'Level: ' : '난이도 ') + t(item.level));
    if(item.instrument) tags.push(t(item.instrument));
    if(!tags.length) return '';
    return '<div class="sm-meta">' + tags.map(function(x){ return '<span>' + x + '</span>'; }).join('') + '</div>';
  }

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

  // 뮤직랩 정기결제 상품은 서버가 기록한 labSubscriptions[id].accessUntil(이용 가능 기한)으로 판단해요.
  // 해지해도 이미 결제한 기간이 끝날 때까지는 계속 이용할 수 있어요.
  function labSubscription(gameId){
    var subs = getEnt().labSubscriptions || {};
    return subs[gameId] || null;
  }
  function hasGameAccess(gameId){
    if(!isLoggedIn()) return false;
    var sub = labSubscription(gameId);
    if(sub) return new Date(sub.accessUntil) > new Date();
    return (getEnt().ownedGameIds || []).indexOf(gameId) > -1;
  }
  // 유료 워크지는 "상품id-언어" 조합으로 구매 여부를 구분해서, 한/영 버전이 각각 따로 결제돼요.
  function worksheetLangId(sheet){ return sheet.id + '-' + getLang(); }

  function hasWorksheetAccess(sheet){
    if(sheet.free) return isLoggedIn();
    return isLoggedIn() && getEnt().paidWorksheetIds.indexOf(worksheetLangId(sheet)) > -1;
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
    'game': {kr:'뮤직랩 이용권 구매', en:'Music Lab purchase'},
    'game-slot': {kr:'구독 플랜으로 뮤직랩 이용', en:'Music Lab via plan'},
    'lab-subscription': {kr:'뮤직랩 정기결제', en:'Music Lab monthly billing'},
    'worksheet': {kr:'워크지 단품 구매', en:'Worksheet purchase'},
    'worksheet-credit': {kr:'구독 크레딧으로 다운로드', en:'Downloaded with subscription credit'},
    'sheetmusic': {kr:'악보+MR 구매', en:'Sheet music + MR purchase'},
    'subscription': {kr:'구독 결제', en:'Subscription payment'}
  };
  function historyItemLabel(item){
    var kindLabel = t(HISTORY_KIND_LABEL[item.kind]) || item.kind;
    var refLabel = item.refId;
    if(item.kind === 'game' || item.kind === 'game-slot' || item.kind === 'lab-subscription'){
      var g = findGame(item.refId); if(g) refLabel = t(g.name);
    }else if(item.kind === 'worksheet' || item.kind === 'worksheet-credit'){
      var langSuffix = item.refId.match(/-(kr|en)$/);
      var baseId = langSuffix ? item.refId.slice(0, -3) : item.refId;
      var w = findWorksheet(baseId);
      if(w) refLabel = t(w.name) + (langSuffix ? ' (' + langSuffix[1].toUpperCase() + ')' : '');
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

  // ⚠️ 포트원 채널 설정
  // - PG_ONETIME : 단건 결제(워크지·악보+MR)용 KG이니시스 채널
  // - PG_BILLING : 정기결제(빌링키 발급)용 KG이니시스 채널
  //   정기결제는 일반결제와 "다른 MID"를 써야 해요. 테스트 MID는 INIBillTst 이고,
  //   포트원 관리자 콘솔 > 결제 연동 > 채널 관리에서 "KG이니시스 · 정기결제" 채널을 추가해야 결제창이 열려요.
  //   카드사 심사가 통과되면 실제 발급받은 정기결제 MID로 바꿔주세요.
  var PG_ONETIME = 'html5_inicis.INIpayTest';
  var PG_BILLING = 'html5_inicis.INIBillTst';
  // ⚠️ 달러(USD) 정기결제 = 페이팔 정기결제(Reference Transaction, paypal_v2)
  // - PAYPAL_CHANNEL_KEY : 포트원 콘솔 > 결제 연동 > 연동 정보 > 채널 관리 에 있는 페이팔 채널의 "채널 키"
  //   비어 있으면 영어 화면에서는 "준비 중" 안내만 나오고 결제가 열리지 않아요(원화로 잘못 청구되지 않도록).
  // - PAYPAL_SANDBOX : 페이팔 테스트 계정이면 true, 실제 운영 계정이면 false
  // - PAYPAL_FRAUDNET_SOURCE : 페이팔 이상거래 방지(Fraudnet)용 식별값. 페이팔 판매자 ID + '_' + 페이지 이름 형태예요.
  //   (예: 7WBB3CKT63FRG_checkout-page) 페이팔/포트원에서 안내받은 값으로 바꿔주세요.
  var PAYPAL_CHANNEL_KEY = 'channel-key-1dc3aafe-a14b-4ae6-991e-24674d8503b6';
  var PAYPAL_SANDBOX = true;
  var PAYPAL_FRAUDNET_SOURCE = 'PA4DULN9V66L6_musiclab';

  var PAY_TEXT = {
    methodTitle:{kr:'결제 수단 선택', en:'Choose a payment method'},
    subTitle:{kr:'정기결제 등록', en:'Set up monthly billing'},
    monthly:{kr:'매월 결제 금액', en:'Monthly amount'},
    total:{kr:'결제 금액', en:'Total'},
    payNow:{kr:'결제 진행', en:'Proceed to pay'},
    subscribeNow:{kr:'정기결제 시작하기', en:'Start monthly billing'},
    consent:{kr:'매월 같은 날 자동으로 결제되는 것에 동의해요. 해지는 마이페이지에서 언제든 할 수 있고, 해지하면 다음 결제일부터 청구되지 않아요.',
             en:'I agree to be charged automatically on the same day every month. I can cancel anytime from My Page, and billing stops from the next billing date.'},
    consentNeeded:{kr:'정기결제 동의에 체크해주세요.', en:'Please agree to monthly billing first.'},
    terms:{kr:'환불 규정 보기', en:'See refund policy'},
    usdNotReady:{kr:'달러 결제는 준비 중이에요. KR로 바꾸면 원화로 결제할 수 있어요.', en:'USD payment is coming soon. Switch to KR to pay in Korean won.'},
    paypalHint:{kr:'아래 페이팔 버튼으로 결제 계정을 등록하면 첫 달이 결제되고, 이후 매월 자동으로 결제돼요.', en:'Register your PayPal account with the button below. Your first month is charged now, then monthly after that.'},
    paypalConsentFirst:{kr:'먼저 위의 정기결제 동의에 체크해주세요.', en:'Please tick the monthly billing agreement above to continue with PayPal.'},
    paypalPending:{kr:'페이팔에서 결제를 확인하고 있어요. 잠시 후 마이페이지에서 확인해주세요.', en:'PayPal is confirming your payment. Please check My Page in a few minutes.'},
    paypalFailed:{kr:'페이팔 등록이 완료되지 않았어요. 다시 시도해주세요.', en:'PayPal registration was not completed. Please try again.'}
  };

  // 결제 모달 안에 "정기결제 동의" 영역을 한 번만 만들어 넣어요 (모든 페이지 공통).
  function ensureConsentBox(){
    if(document.getElementById('payConsentWrap')) return;
    var summary = document.querySelector('#payStepMethod .pay-summary');
    if(!summary) return;
    var wrap = document.createElement('label');
    wrap.id = 'payConsentWrap';
    wrap.className = 'pay-consent';
    wrap.innerHTML = '<input type="checkbox" id="payConsent"><span id="payConsentText"></span>';
    summary.parentNode.insertBefore(wrap, summary.nextSibling);
    var link = document.createElement('a');
    link.id = 'payTermsLink';
    link.className = 'pay-terms-link';
    link.href = 'terms.html#refund';
    link.target = '_blank';
    wrap.parentNode.insertBefore(link, wrap.nextSibling);
  }

  /* ---------- 페이팔 정기결제 (영어 화면 · USD) ----------
     페이팔은 결제창을 직접 여는 방식이 아니라, 결제 모달 안에 "페이팔 버튼"을 그려두고
     구매자가 그 버튼을 누르면 페이팔 계정 등록(빌링키 발급) 창이 열려요.
     등록이 끝나면 서버(startSubscription)가 첫 달 $3.99 를 청구하고 다음 달을 예약해요. */
  var paypalState = { rendered:false, firstMerchantUid:null, current:null };

  function ensurePaypalBox(){
    var wrap = document.getElementById('paypalRtWrap');
    if(wrap) return wrap;
    var anchor = document.getElementById('confirmPayBtn');
    if(!anchor) return null;
    wrap = document.createElement('div');
    wrap.id = 'paypalRtWrap';
    wrap.className = 'paypal-rt-wrap';
    wrap.innerHTML = '<p class="paypal-hint" id="paypalHint"></p>' +
      '<div class="portone-ui-container" data-portone-ui-type="paypal-rt"></div>';
    anchor.parentNode.insertBefore(wrap, anchor);
    return wrap;
  }

  // 페이팔이 요구하는 이상거래 방지 스크립트(Fraudnet). 첫 달 청구 주문번호와 연결돼요.
  function loadPaypalFraudnet(merchantUid){
    if(document.getElementById('ppFraudnetCfg')) return;
    var cfg = document.createElement('script');
    cfg.type = 'application/json';
    cfg.id = 'ppFraudnetCfg';
    cfg.setAttribute('fncls', 'fnparams-dede7cc5-15fd-4c75-a9f4-36c430ee3a99');
    cfg.text = JSON.stringify({ f: merchantUid, s: PAYPAL_FRAUDNET_SOURCE, sandbox: PAYPAL_SANDBOX });
    document.body.appendChild(cfg);
    var fb = document.createElement('script');
    fb.src = 'https://c.paypal.com/da/r/fb.js';
    document.body.appendChild(fb);
  }

  function onPaypalDone(rsp){
    var cur = paypalState.current;
    if(!cur) return;
    $('#payStepMethod').classList.remove('active');
    $('#payStepProcessing').classList.add('active');
    fbFunctions.httpsCallable('startSubscription')({
      customerUid: cur.customerUid,
      expectedAmount: cur.product.price,
      currency: 'USD',
      productType: cur.product.type,
      productId: cur.product.id,
      firstMerchantUid: paypalState.firstMerchantUid
    }).then(function(res){
      var data = (res && res.data) || {};
      return refreshEntitlements().then(function(){
        closeModal('paymentModal');
        paypalState.firstMerchantUid = null;
        if(data.pending){
          showToast(t(PAY_TEXT.paypalPending));
          return;
        }
        showToast(getLang() === 'en' ? 'Monthly billing started.' : '정기결제가 시작됐어요.');
        cur.onSuccess();
      });
    }).catch(function(err){
      console.error('클래쯔피아노: 페이팔 정기결제 확인 실패', err, rsp);
      $('#payStepProcessing').classList.remove('active');
      $('#payStepMethod').classList.add('active');
      showToast(t(PAY_TEXT.paypalFailed));
    });
  }

  function startPaypalCheckout(product, onSuccess, consentBox, ppWrap){
    var hint = $('#paypalHint');
    if(!PAYPAL_CHANNEL_KEY){
      ppWrap.style.display = 'block';
      hint.textContent = t(PAY_TEXT.usdNotReady);
      ppWrap.querySelector('.portone-ui-container').style.display = 'none';
      return;
    }
    var user = currentUser();
    if(!user){ requireLogin(window.location.href); return; }
    if(typeof IMP === 'undefined'){
      showToast('Payment module failed to load. Please refresh and try again.');
      return;
    }
    if(!paypalState.firstMerchantUid){
      paypalState.firstMerchantUid = 'clazzfirst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      loadPaypalFraudnet(paypalState.firstMerchantUid);
    }
    var customerUid = 'clazz_' + user.uid + '_' + product.type + '_' + product.id + '_usd';
    paypalState.current = { product: product, onSuccess: onSuccess, customerUid: customerUid };

    var req = {
      channelKey: PAYPAL_CHANNEL_KEY,
      pay_method: 'paypal',
      merchant_uid: 'clazzpiano_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: t(product.name) + ' (monthly)',
      customer_uid: customerUid,
      customer_id: user.uid,
      buyer_email: user.email || '',
      buyer_name: user.name || ''
    };

    ppWrap.style.display = 'block';
    ppWrap.querySelector('.portone-ui-container').style.display = 'none';
    hint.textContent = t(PAY_TEXT.paypalConsentFirst);

    function showButton(){
      hint.textContent = t(PAY_TEXT.paypalHint);
      ppWrap.querySelector('.portone-ui-container').style.display = 'block';
      IMP.init(IMP_STORE_CODE);
      if(!paypalState.rendered){
        IMP.loadUI('paypal-rt', req, onPaypalDone);
        paypalState.rendered = true;
      }else{
        IMP.updateLoadUIRequest('paypal-rt', req);
      }
    }
    consentBox.onchange = function(){
      if(consentBox.checked){ showButton(); }
      else{
        hint.textContent = t(PAY_TEXT.paypalConsentFirst);
        ppWrap.querySelector('.portone-ui-container').style.display = 'none';
      }
    };
  }

  // product: { name:{kr,en}, price, currency?:'KRW'|'USD', type:'game'|'worksheet'|'sheetmusic'|'tier'|'lab', id, recurring:boolean }
  function openPaymentFlow(product, onSuccess){
    var lang = getLang();
    var recurring = !!product.recurring;
    var currency = product.currency === 'USD' ? 'USD' : 'KRW';
    var priceLabel = currency === 'USD' ? '$' + product.price.toFixed(2) : money(product.price);
    ensureConsentBox();

    var titleEl = $('#payTitleText');
    var subEl = $('#paySubText');
    var amountEl = $('#payAmountText');
    var summaryLabel = document.querySelector('#payStepMethod .pay-summary span');
    var confirmBtn = $('#confirmPayBtn');
    var consentWrap = $('#payConsentWrap');
    var consentBox = $('#payConsent');
    var termsLink = $('#payTermsLink');

    if(titleEl) titleEl.textContent = t(recurring ? PAY_TEXT.subTitle : PAY_TEXT.methodTitle);
    if(subEl) subEl.textContent = t(product.name) + (recurring ? (lang === 'en' ? ' · monthly' : ' · 매월 자동결제') : '');
    if(amountEl) amountEl.textContent = priceLabel + (recurring ? (lang === 'en' ? ' / mo' : ' / 월') : '');
    if(summaryLabel) summaryLabel.textContent = t(recurring ? PAY_TEXT.monthly : PAY_TEXT.total);
    if(confirmBtn) confirmBtn.textContent = t(recurring ? PAY_TEXT.subscribeNow : PAY_TEXT.payNow);
    if(consentWrap){
      consentWrap.style.display = recurring ? 'flex' : 'none';
      $('#payConsentText').textContent = t(PAY_TEXT.consent);
      consentBox.checked = false;
    }
    if(termsLink){
      termsLink.style.display = recurring ? 'inline-block' : 'none';
      termsLink.textContent = t(PAY_TEXT.terms);
    }

    $('#payStepMethod') && $('#payStepMethod').classList.add('active');
    $('#payStepProcessing') && $('#payStepProcessing').classList.remove('active');
    openModal('paymentModal');

    function backToMethod(msg){
      $('#payStepProcessing').classList.remove('active');
      $('#payStepMethod').classList.add('active');
      if(msg) showToast(msg);
    }

    // 영어 화면(달러) 정기결제는 페이팔 버튼으로 진행해요.
    var usePaypal = recurring && currency === 'USD';
    var ppWrap = ensurePaypalBox();
    var methods = document.querySelector('#payStepMethod .pay-methods');
    if(methods) methods.style.display = usePaypal ? 'none' : '';
    if(confirmBtn) confirmBtn.style.display = usePaypal ? 'none' : '';
    if(ppWrap) ppWrap.style.display = 'none';
    if(consentBox) consentBox.onchange = null;
    if(usePaypal && ppWrap){
      startPaypalCheckout(product, onSuccess, consentBox, ppWrap);
      return;
    }

    if(!confirmBtn) return;
    confirmBtn.onclick = function(){
      if(recurring && consentBox && !consentBox.checked){
        showToast(t(PAY_TEXT.consentNeeded));
        return;
      }
      if(typeof IMP === 'undefined'){
        showToast(lang === 'en' ? 'Payment module failed to load. Please refresh and try again.' : '결제 모듈을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
        return;
      }
      var user = currentUser();
      if(!user){ requireLogin(window.location.href); return; }

      $('#payStepMethod').classList.remove('active');
      $('#payStepProcessing').classList.add('active');

      var merchantUid = 'clazzpiano_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var req = {
        pg: recurring ? PG_BILLING : PG_ONETIME,
        pay_method: 'card',
        merchant_uid: merchantUid,
        name: t(product.name) + (recurring ? (lang === 'en' ? ' (monthly)' : ' (월 정기결제)') : ''),
        amount: product.price,
        currency: currency,
        buyer_email: user.email || '',
        buyer_name: user.name || '',
        // KG이니시스는 구매자 연락처가 없으면 결제창이 열리지 않아요.
        buyer_tel: user.phone || '010-0000-0000'
      };
      if(recurring){
        // 카드 정보는 PG사가 보관하고, 우리는 이 고객 식별값(customer_uid)으로만 매달 청구를 요청해요.
        req.customer_uid = 'clazz_' + user.uid + '_' + product.type + '_' + product.id;
      }

      IMP.init(IMP_STORE_CODE);
      IMP.request_pay(req, function(rsp){
        if(!rsp.success){
          backToMethod(rsp.error_msg || (lang === 'en' ? 'Payment was cancelled.' : '결제가 취소됐어요.'));
          return;
        }

        // 브라우저가 "성공했다"고 말하는 걸 그대로 믿지 않고, 서버(Cloud Functions)가
        // 포트원에 직접 확인한 뒤에만 구매/구독을 확정합니다.
        var call = recurring
          ? fbFunctions.httpsCallable('startSubscription')({
              customerUid: req.customer_uid,
              expectedAmount: product.price,
              currency: currency,
              productType: product.type,
              productId: product.id
            })
          : fbFunctions.httpsCallable('verifyPayment')({
              impUid: rsp.imp_uid,
              expectedAmount: product.price,
              productType: product.type,
              productId: product.id
            });

        call.then(function(){
          return refreshEntitlements();
        }).then(function(){
          closeModal('paymentModal');
          showToast(recurring
            ? (lang === 'en' ? 'Monthly billing started.' : '정기결제가 시작됐어요.')
            : (lang === 'en' ? 'Payment complete.' : '결제가 완료됐어요.'));
          onSuccess();
        }).catch(function(err){
          console.error('클래쯔피아노: 결제 확인 실패', err);
          closeModal('paymentModal');
          showToast(lang === 'en'
            ? 'Payment could not be verified. Please contact support.'
            : '결제 확인에 실패했어요. 카드사에서 실제로 결제가 됐다면 문의(mihyun555@gmail.com)로 연락해주세요.');
        });
      });
    };
  }

  // 정기결제 해지: 서버가 포트원의 다음 회차 예약을 취소하고, 이미 결제한 기간까지는 계속 이용하게 해요.
  function cancelSubscription(productType, productId){
    return fbFunctions.httpsCallable('cancelSubscription')({ productType: productType, productId: productId })
      .then(function(){ return refreshEntitlements(); });
  }

  /* ---------- Game player (placeholder stage) ---------- */
  function launchGame(product){
    var lang = getLang();
    var titleEl = $('#playerTitle');
    if(titleEl) titleEl.textContent = t(product.name);
    var stage = $('#playerStage');
    if(stage){
      stage.classList.remove('has-frame');
      stage.innerHTML = '<div class="spinner"></div><p>' + (lang === 'en' ? 'Loading.' : '교구를 불러오는 중이에요.') + '</p>';
    }
    openModal('gamePlayerModal');
    // url 은 문자열 하나이거나 {kr, en} 형태 — 지금 언어에 맞는 버전을 열어요.
    var productUrl = t(product.url);
    if(productUrl && stage){
      stage.classList.add('has-frame');
      stage.innerHTML = '<iframe src="' + productUrl + '" title="' + t(product.name) + '" style="width:100%;height:100%;border:0;" allow="autoplay; fullscreen"></iframe>';
      return;
    }
    setTimeout(function(){
      if(!stage) return;
      stage.innerHTML = lang === 'en'
        ? '<p style="font-family:\'Noto Serif KR\',serif;font-size:1.1rem;color:#F3EFE6;">Almost ready.</p><p>This tool is being connected. Please check back soon.</p>'
        : '<p style="font-family:\'Noto Serif KR\',serif;font-size:1.1rem;color:#F3EFE6;">곧 만나요.</p><p>교구를 연결하고 있어요. 조금만 기다려 주세요.</p>';
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
    initModalDismiss:initModalDismiss, money:money, labPrice:labPrice, moneyUSD:moneyUSD, currentPrice:currentPrice, formatDate:formatDate,

    getLang:getLang, setLang:setLang, t:t, applyI18n:applyI18n,
    initLangToggle:initLangToggle, COMMON_I18N:COMMON_I18N,

    GAMES:GAMES, WORKSHEETS:WORKSHEETS, TIERS:TIERS, SHEET_MUSIC:SHEET_MUSIC,
    WORKSHEET_CATEGORIES:WORKSHEET_CATEGORIES, SHEET_MUSIC_CATEGORIES:SHEET_MUSIC_CATEGORIES,
    comingSoonHTML:comingSoonHTML, sheetMusicMetaHTML:sheetMusicMetaHTML,
    findGame:findGame, findWorksheet:findWorksheet, findTier:findTier, findSheetMusic:findSheetMusic,

    signUp:signUp, logIn:logIn, logOut:logOut,
    currentUser:currentUser, currentUsername:currentUsername, isLoggedIn:isLoggedIn,
    isUsernameTaken:isUsernameTaken,
    requireLogin:requireLogin, paintAuthNav:paintAuthNavLabel,

    getEnt:getEnt, onReady:onReady,
    hasGameAccess:hasGameAccess, labSubscription:labSubscription, cancelSubscription:cancelSubscription, hasWorksheetAccess:hasWorksheetAccess, hasSheetMusicAccess:hasSheetMusicAccess,
    grantGamePurchase:grantGamePurchase, useGameSlot:useGameSlot,
    grantWorksheetPurchase:grantWorksheetPurchase, useWorksheetCredit:useWorksheetCredit,
    grantSheetMusicPurchase:grantSheetMusicPurchase,
    logFreeDownload:logFreeDownload, subscribeTier:subscribeTier,
    historyItemLabel:historyItemLabel, freeDownloadLabel:freeDownloadLabel, tierDisplayName:tierDisplayName,

    openPaymentFlow:openPaymentFlow, launchGame:launchGame,
    downloadWorksheetFile:downloadWorksheetFile,
    downloadStorageFile:downloadStorageFile,
    openSheetMusicPreview:openSheetMusicPreview,
    worksheetStoragePath:worksheetStoragePath, worksheetLangId:worksheetLangId,
    sheetMusicPdfPath:sheetMusicPdfPath,
    sheetMusicMrPath:sheetMusicMrPath
  };
})();
