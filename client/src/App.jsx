import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";

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
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [showUserList, setShowUserList] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [drawResult, setDrawResult] = useState([]);

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setLoggedIn(true);
    }

    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
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
    socket.on("admin_draw_result", (res) => setDrawResult(res));

    return () => socket.off();
  }, []);

  // --- イベントハンドラ ---
  const handleLogin = () => {
    if (!name) return;
    socket.emit("login", { name });
  };

  const handleAdminLogin = () => {
    if (adminPassword === "admin123") {
      setAdminMode(true);
      setLoggedIn(true);
    } else {
      alert("パスワードが間違っています");
    }
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

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win");
  };

  const handleShowHistory = () => socket.emit("request_history");
  const handleLogout = () => {
    if (!window.confirm("ログイン名、対戦履歴がリセットされます。ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    window.location.reload();
  };
  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleViewUsers = () => {
    if (showUserList) setShowUserList(false);
    else {
      socket.emit("admin_view_users");
      setShowUserList(true);
    }
  };
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div
        className="login-screen"
        style={{
          backgroundImage: `url("/images/background.jpg")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          minHeight: "100vh",
        }}
      >
        {/* 管理者ログイン右上 */}
        <div className="admin-login-topright">
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者パスワード"
            inputMode="latin"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          <button className="admin-btn" onClick={handleAdminLogin}>
            管理者ログイン
          </button>
        </div>

        {/* ユーザーログイン */}
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="main-btn" onClick={handleLogin}>
            ログイン
          </button>
        </div>
      </div>
    );
  }

  // 以下、既存の管理者画面・ユーザー画面・対戦画面はそのまま…
  // 省略（変更不要）
}

export default App;
export { socket };
