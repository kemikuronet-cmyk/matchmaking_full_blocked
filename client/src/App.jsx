import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import "./App.css";
import backgroundImage from "./images/background.jpg";

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
    socket.on("admin_ok", () => {
      setAdminMode(true);
      socket.emit("admin_view_users"); // 管理者ログイン時にユーザー一覧取得
    });
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => setDrawResult(res));

    return () => socket.off();
  }, []);

  const handleLogin = () => {
    if (!name) return;
    socket.emit("login", { name });
  };

  const handleAdminLogin = () => {
    if (adminPassword === "admin123") {
      socket.emit("admin_login", { password: adminPassword });
    } else {
      alert("パスワードが間違っています");
    }
  };

  const handleFindOpponent = () => {
    if (!matchEnabled) return;
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win");
    setSearching(false);
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

  const commonStyle = {
    backgroundImage: `url(${backgroundImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    minHeight: "100vh",
  };

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="login-screen app-background" style={commonStyle}>
        <div className="admin-login-topright">
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者パスワード"
          />
          <button className="admin-btn" onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <input type="text" placeholder="ユーザー名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      </div>
    );
  }

  // --- 管理者画面 ---
  if (adminMode) {
    return (
      <div className="app app-background" style={commonStyle}>
        <div className="header">管理者画面</div>
        <div className="admin-screen">
          <div className="admin-section">
            <button className="main-btn" onClick={handleToggleMatch}>
              {matchEnabled ? "マッチング状態" : "マッチング開始"}
            </button>
          </div>
          <div className="admin-section">
            <button className="main-btn" onClick={handleViewUsers}>ユーザー一覧表示</button>
            {showUserList && (
              <table style={{ color: "white", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名前</th>
                    <th>対戦数</th>
                    <th>勝</th>
                    <th>敗</th>
                    <th>ログイン時間</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map((u) => {
                    const win = u.history ? u.history.filter(h => h.result === "win").length : 0;
                    const lose = u.history ? u.history.filter(h => h.result === "lose").length : 0;
                    const loginTime = u.loginTime ? new Date(u.loginTime).toLocaleString() : "未ログイン";
                    return (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>{u.name}</td>
                        <td>{u.history ? u.history.length : 0}</td>
                        <td>{win}</td>
                        <td>{lose}</td>
                        <td>{loginTime}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <button className="main-btn" onClick={handleAdminLogoutAll}>全ユーザーをログアウト</button>
          </div>
          <div className="admin-section">
            <h3>抽選</h3>
            <input type="number" min="1" value={drawCount} onChange={(e) => setDrawCount(Number(e.target.value))} />
            <button className="main-btn" onClick={handleDrawLots}>抽選する</button>
            <ul>
              {drawResult.map((u) => (
                <li key={u.id}>{u.id} | {u.name}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // --- 対戦中画面 ---
  if (opponent) {
    return (
      <div className="battle-screen app-background" style={commonStyle}>
        <h3 className="text-on-background">対戦相手: {opponent.name}</h3>
        <div className="text-on-background">卓番号: {deskNum}</div>
        <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
      </div>
    );
  }

  // --- ユーザーメニュー ---
  return (
    <div className="app app-background" style={commonStyle}>
      <div className="header">{user?.name}</div>
      <div className="menu-screen">
        {!searching && matchEnabled && <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>}
        {searching && <button className="main-btn" onClick={handleCancelSearch}>検索をキャンセル</button>}
        {!matchEnabled && <div className="match-disabled">マッチング受付時間外です</div>}
        <button className="main-btn" onClick={handleShowHistory}>対戦履歴を確認する</button>
        <button className="main-btn" onClick={handleLogout}>ログアウト</button>
      </div>
      {showHistory && (
        <div className="history-modal">
          <h3>対戦履歴</h3>
          <ul>
            {history.map((h, i) => (
              <li key={i}>相手: {h.opponent} | 結果: {h.result}</li>
            ))}
          </ul>
          <button className="main-btn" onClick={() => setShowHistory(false)}>閉じる</button>
        </div>
      )}
    </div>
  );
}

export default App;
export { socket };
