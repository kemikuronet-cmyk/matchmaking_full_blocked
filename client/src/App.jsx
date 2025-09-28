import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket の定義
const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000"
);

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);

  // --- Socket イベント ---
  useEffect(() => {
    // 自動ログイン復元
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
    }

    // Socket イベント登録
    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum("");
      setSearching(false);
    });

    socket.on("force_logout", () => {
      localStorage.removeItem("user");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
    });

    socket.on("history", (hist) => {
      setHistory(hist);
      setShowHistory(true);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_user_list", (list) => setUsersList(list));

    return () => {
      socket.off();
    };
  }, []);

  // --- イベントハンドラ ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (!name) return;
    socket.emit("login", { name });
  };

  const handleFindOpponent = () => {
    if (searching) {
      setSearching(false);
      socket.emit("cancel_find");
    } else {
      setSearching(true);
      socket.emit("find_opponent");
    }
  };

  const handleShowHistory = () => socket.emit("request_history");
  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    window.location.reload();
  };

  const handleAdminLogin = () => socket.emit("admin_login", { password: adminPassword });
  const handleToggleMatch = (enable) => socket.emit("admin_toggle_match", { enable });
  const handleViewUsers = () => socket.emit("admin_view_users");
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="login-screen">
        {/* 管理者ログイン右上 */}
        <div className="admin-login-topright">
          <h4>管理者としてログイン</h4>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者パスワード"
          />
          <button className="green-btn" onClick={handleAdminLogin}>管理者ログイン</button>
        </div>

        {/* ユーザーとしてログイン中央 */}
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              name="username"
              placeholder="ユーザー名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="green-btn" type="submit">ログイン</button>
          </form>
        </div>
      </div>
    );
  }

  if (adminMode) {
    return (
      <div className="app">
        <div className="header">管理者画面</div>
        <div className="admin-screen">
          <div className="admin-section">
            <h3>マッチング操作</h3>
            <button className="green-btn" onClick={() => handleToggleMatch(true)}>マッチング開始</button>
            <button className="green-btn" onClick={() => handleToggleMatch(false)}>マッチング終了</button>
            <div>{matchEnabled ? "マッチング状態" : "マッチング受付時間外"}</div>
          </div>

          <div className="admin-section">
            <h3>ユーザー管理</h3>
            <button className="green-btn" onClick={handleViewUsers}>ユーザー一覧表示</button>
            <button className="green-btn" onClick={handleAdminLogoutAll}>全ユーザーをログアウト</button>
            <ul>
              {usersList.map((u) => (
                <li key={u.id}>{u.id} | {u.name} | 対戦数: {u.history.length}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="user-menu-center">
        {matchEnabled ? (
          <button className="green-btn" onClick={handleFindOpponent}>
            {searching ? "対戦相手を探しています…" : "対戦相手を探す"}
          </button>
        ) : (
          <div className="match-disabled">マッチング受付時間外です</div>
        )}
        <button className="green-btn" onClick={handleShowHistory}>対戦履歴</button>
        <button className="green-btn" onClick={handleLogout}>ログアウト</button>
      </div>

      {opponent && (
        <div className="battle-screen">
          <h3>対戦相手: {opponent.name}</h3>
          <div>卓番号: {deskNum}</div>
          <button className="green-btn" onClick={() => socket.emit("report_win")}>勝利報告</button>
        </div>
      )}

      {showHistory && (
        <div className="history-modal">
          <h3>対戦履歴</h3>
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                相手: {h.opponent} | {h.result} | 開始: {h.startTime} | 終了: {h.endTime}
              </li>
            ))}
          </ul>
          <button className="green-btn" onClick={() => setShowHistory(false)}>閉じる</button>
        </div>
      )}
    </div>
  );
}

export default App;
export { socket };
