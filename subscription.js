/* =========================================================
   클래쯔피아노 정기결제 서버 함수 (Firebase Cloud Functions v2)

   기존 functions/index.js 맨 아래에 이 한 줄을 추가해서 함께 배포하세요:
     Object.assign(exports, require('./subscription'));

   필요한 설정
   1) 포트원 API 키/시크릿 (이미 verifyPayment에서 쓰고 있다면 같은 값)
        firebase functions:secrets:set PORTONE_API_KEY
        firebase functions:secrets:set PORTONE_API_SECRET
   2) 포트원 콘솔 > 결제 연동 > 웹훅 URL 에 portoneWebhook 함수 주소 등록
        예) https://us-central1-clazzpiano-5bd10.cloudfunctions.net/portoneWebhook
   3) 포트원 콘솔 > 채널 관리에 "KG이니시스 정기결제" 채널 추가 (테스트 MID: INIBillTst)

   흐름
   - 브라우저: 결제창에서 카드 등록(빌링키 발급, customer_uid)
   - startSubscription: 빌링키 확인 → 첫 달 결제 → 다음 달 결제 예약 → 이용권 지급
   - portoneWebhook: 예약 결제 결과를 받아 성공이면 한 달 연장 + 다음 달 예약, 실패면 이용 중지
   - cancelSubscription: 다음 달 예약 취소 (이미 결제한 기간까지는 이용 가능)
   ========================================================= */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const PORTONE_API_KEY = defineSecret('PORTONE_API_KEY');
const PORTONE_API_SECRET = defineSecret('PORTONE_API_SECRET');
// 사이트(app.js)가 firebase.functions() 기본 지역(us-central1)을 부르므로 지역을 따로 지정하지 않아요.
const OPTS = { secrets: [PORTONE_API_KEY, PORTONE_API_SECRET] };

// ⚠️ 가격은 반드시 서버에서 정해요. app.js의 가격과 항상 같게 유지해주세요.
const PRODUCTS = {
  'lab:note-brain': { price: 3900, priceUSD: 3.99, name: '계이름 브레인 (월 정기결제)', nameEn: 'Solfège Brain (monthly)' },
  'tier:basic':      { price: 9900,  name: '베이직 구독',   games: 1, worksheets: 5 },
  'tier:standard':   { price: 15900, name: '스탠다드 구독', games: 2, worksheets: 10 },
  'tier:premium':    { price: 19900, name: '프리미엄 구독', games: 3, worksheets: 10 }
};

/* ---------- 포트원 API ---------- */
async function portoneToken() {
  const res = await fetch('https://api.iamport.kr/users/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imp_key: PORTONE_API_KEY.value(), imp_secret: PORTONE_API_SECRET.value() })
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error('포트원 토큰 발급 실패: ' + json.message);
  return json.response.access_token;
}
async function portone(token, method, path, body) {
  const res = await fetch('https://api.iamport.kr' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

/* ---------- 날짜: 한 달 뒤 같은 날 (없는 날짜면 그 달 말일) ---------- */
function addOneMonth(date) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}
function newMerchantUid(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

async function scheduleNext(token, sub, when) {
  const merchantUid = newMerchantUid('clazzsub');
  const json = await portone(token, 'POST', '/subscribe/payments/schedule', {
    customer_uid: sub.customerUid,
    schedules: [{
      merchant_uid: merchantUid,
      schedule_at: Math.floor(when.getTime() / 1000),
      amount: sub.price,
      currency: sub.currency || 'KRW',
      name: sub.name
    }]
  });
  if (json.code !== 0) throw new Error('다음 결제 예약 실패: ' + json.message);
  await db.collection('billing').doc(merchantUid).set({
    uid: sub.uid, productType: sub.productType, productId: sub.productId,
    customerUid: sub.customerUid, price: sub.price, currency: sub.currency || 'KRW', name: sub.name, scheduledAt: when.toISOString()
  });
  return merchantUid;
}

/* ---------- 이용권 반영 ---------- */
async function applyPaidPeriod(sub, paidAt, nextBillingAt, isFirst) {
  const ref = db.collection('entitlements').doc(sub.uid);
  const history = {
    kind: sub.productType === 'lab' ? 'lab-subscription' : 'subscription',
    refId: sub.productId, price: sub.price, currency: sub.currency || 'KRW', date: paidAt.toISOString()
  };
  if (sub.productType === 'lab') {
    await ref.set({
      labSubscriptions: {
        [sub.productId]: {
          status: 'active', price: sub.price, currency: sub.currency || 'KRW', customerUid: sub.customerUid,
          nextBillingAt: nextBillingAt.toISOString(), accessUntil: nextBillingAt.toISOString(),
          ...(isFirst ? { startedAt: paidAt.toISOString() } : {})
        }
      },
      purchaseHistory: FieldValue.arrayUnion(history)
    }, { merge: true });
  } else {
    const p = PRODUCTS['tier:' + sub.productId];
    await ref.set({
      subscription: {
        tierId: sub.productId, price: sub.price, status: 'active', customerUid: sub.customerUid,
        purchasedAt: paidAt.toISOString(), renewsOn: nextBillingAt.toISOString()
      },
      gameSlotsTotal: p.games,
      gameSlotsUsed: 0,
      worksheetCredits: FieldValue.increment(p.worksheets),
      purchaseHistory: FieldValue.arrayUnion(history)
    }, { merge: true });
  }
}

/* ---------- 1) 정기결제 시작 ---------- */
exports.startSubscription = onCall(OPTS, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
  const uid = req.auth.uid;
  const { customerUid, expectedAmount, productType, productId } = req.data || {};
  const currency = (req.data && req.data.currency) === 'USD' ? 'USD' : 'KRW';
  const product = PRODUCTS[productType + ':' + productId];
  if (!product) throw new HttpsError('invalid-argument', '알 수 없는 상품이에요.');
  const price = currency === 'USD' ? product.priceUSD : product.price;
  if (!price || price !== expectedAmount) throw new HttpsError('invalid-argument', '금액이 맞지 않아요.');
  const name = currency === 'USD' ? (product.nameEn || product.name) : product.name;
  if (customerUid !== 'clazz_' + uid + '_' + productType + '_' + productId + (currency === 'USD' ? '_usd' : '')) {
    throw new HttpsError('permission-denied', '결제 정보가 올바르지 않아요.');
  }

  const token = await portoneToken();

  // 빌링키가 실제로 발급됐는지 포트원에 직접 확인
  const cust = await portone(token, 'GET', '/subscribe/customers/' + encodeURIComponent(customerUid));
  if (cust.code !== 0) throw new HttpsError('failed-precondition', '카드 등록을 확인하지 못했어요.');

  // 첫 달 결제
  const firstUid = newMerchantUid('clazzfirst');
  const pay = await portone(token, 'POST', '/subscribe/payments/again', {
    customer_uid: customerUid, merchant_uid: firstUid, amount: price, currency, name
  });
  if (pay.code !== 0 || !pay.response || pay.response.status !== 'paid') {
    throw new HttpsError('aborted', '첫 결제가 승인되지 않았어요: ' + ((pay.response && pay.response.fail_reason) || pay.message));
  }

  const sub = { uid, productType, productId, customerUid, price, currency, name };
  const paidAt = new Date();
  const nextAt = addOneMonth(paidAt);
  await scheduleNext(token, sub, nextAt);
  await applyPaidPeriod(sub, paidAt, nextAt, true);
  return { ok: true, nextBillingAt: nextAt.toISOString() };
});

/* ---------- 2) 예약 결제 결과 웹훅 ---------- */
exports.portoneWebhook = onRequest(OPTS, async (req, res) => {
  try {
    const { imp_uid, merchant_uid } = req.body || {};
    if (!imp_uid || !merchant_uid) { res.status(200).send('ignored'); return; }

    const billingSnap = await db.collection('billing').doc(merchant_uid).get();
    if (!billingSnap.exists) { res.status(200).send('not-subscription'); return; }
    const sub = billingSnap.data();
    if (billingSnap.data().handled) { res.status(200).send('already'); return; }

    const token = await portoneToken();
    const payment = await portone(token, 'GET', '/payments/' + encodeURIComponent(imp_uid));
    const p = payment.response;
    if (!p || p.merchant_uid !== merchant_uid) { res.status(400).send('mismatch'); return; }

    if (p.status === 'paid' && p.amount === sub.price) {
      const paidAt = new Date(p.paid_at * 1000);
      const nextAt = addOneMonth(new Date(sub.scheduledAt));
      await scheduleNext(token, sub, nextAt);
      await applyPaidPeriod(sub, paidAt, nextAt, false);
      await billingSnap.ref.update({ handled: true, status: 'paid' });
    } else if (p.status === 'failed') {
      const ref = db.collection('entitlements').doc(sub.uid);
      const now = new Date().toISOString();
      if (sub.productType === 'lab') {
        await ref.set({ labSubscriptions: { [sub.productId]: { status: 'payment_failed', accessUntil: now } } }, { merge: true });
      } else {
        await ref.set({ subscription: { status: 'payment_failed', renewsOn: now } }, { merge: true });
      }
      await billingSnap.ref.update({ handled: true, status: 'failed', failReason: p.fail_reason || '' });
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error('portoneWebhook error', e);
    res.status(500).send('error');
  }
});

/* ---------- 3) 정기결제 해지 ---------- */
exports.cancelSubscription = onCall(OPTS, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요해요.');
  const uid = req.auth.uid;
  const { productType, productId } = req.data || {};
  if (!PRODUCTS[productType + ':' + productId]) throw new HttpsError('invalid-argument', '알 수 없는 상품이에요.');

  // 원화/달러 중 실제로 등록된 카드(customer_uid)로 해지해요.
  const entSnap = await db.collection('entitlements').doc(uid).get();
  const ent = entSnap.exists ? entSnap.data() : {};
  const stored = productType === 'lab'
    ? (ent.labSubscriptions && ent.labSubscriptions[productId] && ent.labSubscriptions[productId].customerUid)
    : (ent.subscription && ent.subscription.customerUid);
  const customerUid = stored || ('clazz_' + uid + '_' + productType + '_' + productId);
  const token = await portoneToken();
  const json = await portone(token, 'POST', '/subscribe/payments/unschedule', { customer_uid: customerUid });
  // 예약이 이미 없는 경우(code !== 0)도 해지 상태로 기록해요.
  if (json.code !== 0) console.warn('unschedule:', json.message);

  const ref = db.collection('entitlements').doc(uid);
  if (productType === 'lab') {
    await ref.set({ labSubscriptions: { [productId]: { status: 'cancelled', cancelledAt: new Date().toISOString() } } }, { merge: true });
  } else {
    await ref.set({ subscription: { status: 'cancelled', cancelledAt: new Date().toISOString() } }, { merge: true });
  }
  return { ok: true };
});
