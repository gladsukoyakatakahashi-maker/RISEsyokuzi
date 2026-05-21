/**
 * src/utils/db.js
 * Phase 2 で有効化するFirestore接続モジュール。
 * Phase 1 では import するだけでエラーにならないよう、各関数をスタブとして定義。
 *
 * 有効化手順:
 *   npm install firebase-admin
 *   .env に FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL を追加
 *   下記の「// Phase 2:」コメントブロックのコメントアウトを外す
 */

// Phase 2: コメントアウトを外す
// const admin = require('firebase-admin');
// admin.initializeApp({
//   credential: admin.credential.cert({
//     projectId: process.env.FIREBASE_PROJECT_ID,
//     privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
//     clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//   }),
// });
// const db = admin.firestore();

// ---- ユーザー操作 ----

/**
 * ユーザープロフィールを取得する
 * @param {string} userId - LINE の userId
 * @returns {Promise<Object>} user オブジェクト
 */
async function getUser(userId) {
  // Phase 2:
  // const snap = await db.collection('users').doc(userId).get();
  // if (!snap.exists) return null;
  // return snap.data();

  // Phase 1: ダミー返却
  return {
    name: 'テストユーザー',
    goal: '減量',
    targetWeight: 60,
    calorieTarget: 1800,
    proteinTarget: 120,
    allergies: 'なし',
    onboardingDone: false,
  };
}

/**
 * ユーザープロフィールを作成・更新する
 * @param {string} userId
 * @param {Object} data
 */
async function setUser(userId, data) {
  // Phase 2:
  // await db.collection('users').doc(userId).set(data, { merge: true });
  console.log('[db.setUser stub]', userId, data);
}

// ---- 食事記録操作 ----

/**
 * 今日の食事累計を取得する
 * @param {string} userId
 * @returns {Promise<{calories, protein, fat, carbs}>}
 */
async function getTodayTotal(userId) {
  // Phase 2:
  // const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // const snap = await db
  //   .collection('users').doc(userId)
  //   .collection('dailyTotals').doc(today)
  //   .get();
  // return snap.exists ? snap.data() : { calories: 0, protein: 0, fat: 0, carbs: 0 };

  return { calories: 600, protein: 40, fat: 20, carbs: 80 };
}

/**
 * 食事を保存し、日次累計を加算する
 * @param {string} userId
 * @param {Object} meal - { text?, imageBase64?, analysis, calories, protein, fat, carbs, timestamp }
 */
async function saveMeal(userId, meal) {
  // Phase 2:
  // const today = new Date().toISOString().slice(0, 10);
  // const batch = db.batch();
  //
  // // 個別の食事ドキュメントに保存
  // const mealRef = db.collection('users').doc(userId).collection('meals').doc();
  // batch.set(mealRef, { ...meal, date: today });
  //
  // // 日次累計に加算
  // const totalRef = db.collection('users').doc(userId).collection('dailyTotals').doc(today);
  // batch.set(totalRef, {
  //   calories: admin.firestore.FieldValue.increment(meal.calories || 0),
  //   protein:  admin.firestore.FieldValue.increment(meal.protein  || 0),
  //   fat:      admin.firestore.FieldValue.increment(meal.fat      || 0),
  //   carbs:    admin.firestore.FieldValue.increment(meal.carbs    || 0),
  // }, { merge: true });
  //
  // await batch.commit();
  console.log('[db.saveMeal stub]', userId, meal.timestamp);
}

// ---- 週次集計 ----

/**
 * 過去7日間の集計データを返す（週次サマリー生成用）
 * @param {string} userId
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate   - 'YYYY-MM-DD'
 * @returns {Promise<Object>} weeklyStats
 */
async function getWeeklyStats(userId, startDate, endDate) {
  // Phase 2:
  // const snap = await db
  //   .collection('users').doc(userId)
  //   .collection('dailyTotals')
  //   .where(admin.firestore.FieldPath.documentId(), '>=', startDate)
  //   .where(admin.firestore.FieldPath.documentId(), '<=', endDate)
  //   .get();
  //
  // const days = snap.docs.map(d => d.data());
  // const recordedDays = days.length;
  // const avg = (key) =>
  //   recordedDays ? Math.round(days.reduce((s, d) => s + (d[key] || 0), 0) / recordedDays) : 0;
  //
  // return {
  //   startDate, endDate, recordedDays,
  //   avgCalories: avg('calories'),
  //   avgProtein:  avg('protein'),
  //   avgFat:      avg('fat'),
  //   avgCarbs:    avg('carbs'),
  //   topMeals: ['唐揚げ定食', 'サラダチキン', 'ヨーグルト'], // 別途集計
  // };

  return {
    startDate,
    endDate,
    recordedDays: 6,
    avgCalories: 1820,
    avgProtein: 78,
    avgFat: 62,
    avgCarbs: 195,
    topMeals: ['唐揚げ定食', 'サラダチキン', 'ヨーグルト'],
  };
}

module.exports = { getUser, setUser, getTodayTotal, saveMeal, getWeeklyStats };
