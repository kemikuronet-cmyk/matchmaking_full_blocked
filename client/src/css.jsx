/* 全体背景 */
body, html, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background: url("./images/background.jpg") no-repeat center center fixed;
  background-size: cover;
  font-family: Arial, sans-serif;
  color: white;
}

/* アプリ全体 */
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  position: relative;
}

/* 管理者ログイン右上 */
.admin-login-topright {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(0,0,0,0.7);
  padding: 6px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  z-index: 10;
}

.admin-login-topright input {
  padding: 3px 5px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #444;
  background: rgba(0,0,0,0.6);
  color: white;
  width: 100px;
}

.admin-login-topright button {
  padding: 3px 6px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  background: #b22222;
  color: white;
}

.admin-login-topright button:hover {
  background: #d32f2f;
}

/* メイン中央コンテナ */
.main-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* ユーザーログイン中央揃え */
.user-login-center {
  background: rgba(0,0,0,0.7);
  padding: 20px;
  border-radius: 10px;
  margin-top: 100px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 入力欄 */
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

/* ボタン */
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

/* 管理者画面 */
.admin-panel {
  background: rgba(0,0,0,0.7);
  margin: 15px;
  padding: 15px;
  border-radius: 10px;
  width: 90%;
  max-width: 800px;
}

/* ユーザー画面 */
.user-menu {
  background: rgba(0,0,0,0.7);
  margin: 15px;
  padding: 15px;
  border-radius: 10px;
  width: 90%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 対戦履歴 */
.history-list {
  margin-top: 20px;
  width: 100%;
  background: rgba(0,0,0,0.6);
  border-radius: 10px;
  padding: 10px;
}

.history-list li {
  padding: 5px;
  border-bottom: 1px solid #555;
  text-align: center;
}

.win { color: #00aaff; font-weight: bold; }
.lose { color: red; font-weight: bold; }

/* 抽選当選者 */
.lottery-user-section li {
  list-style: none;
}
