/* =======================
   全体背景
   ======================= */
body, html, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: Arial, sans-serif;
  color: white;
  background: url("/images/background.jpg") no-repeat center center fixed;
  background-size: cover;
}

/* =======================
   共通レイアウト
   ======================= */
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 20px;
  position: relative;
}

/* =======================
   ヘッダー
   ======================= */
.header {
  width: 100%;
  padding: 15px;
  background: rgba(0,0,0,0.7);
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  position: sticky;
  top: 0;
  z-index: 10;
}

/* =======================
   ログイン画面（中央揃え）
   ======================= */
.login-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  width: 100%;
}

.user-login-center {
  background: rgba(0,0,0,0.7);
  padding: 30px;
  border-radius: 10px;
  text-align: center;
  min-width: 250px;
}

/* =======================
   管理者ログイン右上
   ======================= */
.admin-login-topright {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0,0,0,0.7);
  padding: 6px;
  border-radius: 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  z-index: 10;
}

.admin-login-topright input {
  padding: 3px 5px;
  font-size: 10px;
  border-radius: 4px;
  border: 1px solid #444;
  background: rgba(0,0,0,0.6);
  color: white;
  width: 100px;
}

.admin-login-topright button {
  padding: 3px 6px;
  font-size: 10px;
  border-radius: 4px;
  cursor: pointer;
  background: #b22222;
  color: white;
}

.admin-login-topright button:hover {
  background: #d32f2f;
}

/* =======================
   入力欄
   ======================= */
input {
  display: block;
  margin: 10px auto;
  padding: 8px;
  border-radius: 5px;
  border: 1px solid #444;
  background: rgba(0,0,0,0.6);
  color: white;
  width: 200px;
}

/* =======================
   ボタン
   ======================= */
button {
  margin: 5px;
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: bold;
}

.main-btn {
  background: #444;
  color: white;
}

.main-btn:hover {
  background: #666;
}

.admin-btn {
  background: #b22222;
  color: white;
}

.admin-btn:hover {
  background: #d32f2f;
}

/* =======================
   管理者画面
   ======================= */
.admin-panel {
  background: rgba(0,0,0,0.7);
  margin: 15px 0;
  padding: 15px;
  border-radius: 10px;
  width: 100%;
  max-width: 600px;
}

.admin-controls button {
  margin-right: 5px;
}

/* =======================
   ユーザー画面
   ======================= */
.user-menu, .battle-info, .lottery-admin-section, .desk-section {
  width: 100%;
  max-width: 600px;
  margin: 10px auto;
}

.user-stats p {
  margin: 5px 0;
}

/* =======================
   対戦履歴
   ======================= */
.history-list {
  margin-top: 20px;
  width: 100%;
  max-width: 500px;
  background: rgba(0,0,0,0.6);
  border-radius: 10px;
  padding: 10px;
}

.history-list ul, .history-list li {
  list-style: none;
  padding: 0;
  margin: 0;
}

.win {
  color: #00aaff;
  font-weight: bold;
}

.lose {
  color: red;
  font-weight: bold;
}

/* =======================
   抽選関連
   ======================= */
.lottery-user-history, .lottery-list {
  margin-top: 15px;
  color: yellow;
}

/* =======================
   テーブル・リスト共通
   ======================= */
ul {
  padding-left: 0;
}
