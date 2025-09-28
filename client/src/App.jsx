import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket 定義
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
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [matchEnabled, setMatchEnabled] = useState(false);

  useEffect(() => {
    // 自動ログイン復元
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
    }

    // Socket イベント
    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));
    });

    socket.on("matched", ({ opponent }) => {
      setOpponent(opponent);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setSearching(false);
    });

    socket.on("force_logout", () => {
      localStorage.removeItem("user");
      setUser(null);
      setLoggedIn(false);
      setAdminMode(false);
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    // クリーンアップ
    return () => socket.off();
  }, []);

  const handleLogin = () => {
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
    socket.emit("logout");
    localStorage.removeItem("user");
    window.location.reload();
  };
  const handleAdminLogin = () => socket.emit("admin_login", { password: adminPassword });

  // --- レンダリング ---
  if (!loggedIn) {
    return (
      <div className="login-screen">
        {/* 管理者ログイン右上 */}
        <div className="admin-login-topright">
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
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="green-btn" onClick={handleLogin}>ログイン</button>
        </div>
      </div>
    );
  }

  if (adminMode) {
    return <div className="app">管理者画面（既存管理者UI）</div>;
  }

  // ユーザー画面
  return (
    <div className="app">
      <div className="user-menu-center">
        {!opponent ? (
          <>
            <button className="green-btn" onClick={handleFindOpponent}>
              {searching ? "対戦相手を探しています…" : "対戦相手を探す"}
            </button>
            <button className="green-btn" onClick={handleShowHistory}>対戦履歴</button>
            <button className="green-btn" onClick={handleLogout}>ログアウト</button>
          </>
        ) : (
          <div>
            <h3>対戦相手: {opponent.name}</h3>
            <button className="green-btn" onClick={() => socket.emit("report_win")}>勝利報告</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
export { socket };
