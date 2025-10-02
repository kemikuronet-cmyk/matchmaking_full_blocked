import React, { useState, useEffect, useRef } from "react";
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
  const [deskNum, setDeskNum] = useState(null);

  const [history, setHistory] = useState([]);

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [showUserList, setShowUserList] = useState(false);

  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [drawResult, setDrawResult] = useState([]);

  const [lotteryWinner, setLotteryWinner] = useState(false);
  const [lotteryList, setLotteryList] = useState([]);
  const [showLottery, setShowLottery] = useState(false);

  const loginAttempted = useRef(false);

  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        const u = JSON.parse(savedUser);
        setUser(u);
        setLoggedIn(true);
        socket.emit("login", { name: u.name, sessionId: u.sessionId });
      }
      loginAttempted.current = true;
    }

    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      localStorage.setItem("user", JSON.stringify(u));
      setSearching(u.status === "searching");
      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum);
      } else {
        setOpponent(null);
        setDeskNum(null);
      }
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    socket.on("force_logout", () => {
      localStorage.removeItem("user");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinner(false);
    });

    socket.on("history", (hist) => setHistory(hist));
    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("パスワードが間違っています"));
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => setDrawResult(res));
    socket.on("lottery_winner", () => setLotteryWinner(true));
    socket.on("update_lottery_list", (list) => setLotteryList(list));

    return () => socket.off();
  }, []);

  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    socket.emit("login", { name: trimmedName });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
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
    setOpponent(null);
    setDeskNum(null);
    setSearching(false);
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    setLotteryWinner(false);
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
  const handleDrawLots = () => {
    socket.emit("admin_draw_lots", { 
      count: drawCount,
      minMatches: minMatches,
      minLoginHours: minLoginHours
    });
  };
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="login-screen">
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>

        <div className="admin-login-topright">
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="管理者パスワード"
          />
          <button className="admin-btn" onClick={handleAdminLogin}>管理者ログイン</button>
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
                    <th>ID</th><th>名前</th><th>対戦数</th><th>勝</th><th>敗</th><th>ログイン時間</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.map(u => {
                    const win = u.history ? u.history.filter(h => h.result === "勝ち").length : 0;
                    const lose = u.history ? u.history.filter(h => h.result === "負け").length : 0;
                    const loginTime = u.loginTime ? new Date(u.loginTime).toLocaleString() : "未ログイン";
                    return (
                      <tr key={u.id}>
                        <td>{u.id}</td><td>{u.name}</td><td>{u.history?.length || 0}</td>
                        <td>{win}</td><td>{lose}</td><td>{loginTime}</td>
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
            <label>抽選人数: <input type="number" min="1" value={drawCount} onChange={e => setDrawCount(Number(e.target.value))}/></label>
            <label>対戦数以上: <input type="number" min="0" value={minMatches} onChange={e => setMinMatches(Number(e.target.value))}/></label>
            <label>ログイン時間以上(時間): <input type="number" min="0" value={minLoginHours} onChange={e => setMinLoginHours(Number(e.target.value))}/></label>
            <button className="main-btn" onClick={handleDrawLots}>抽選する</button>
            <ul>
              {drawResult.map((u,i) => <li key={i}>{u.name}</li>)}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (opponent) {
    return (
      <div className="battle-screen">
        <h3>対戦相手: {opponent.name}</h3>
        <div>卓番号: {deskNum}</div>
        <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
      </div>
    );
  }

  // --- ユーザーメニュー ---
  const isWinner = lotteryList.some(u => u.name === user?.name);

  return (
    <div className="app">
      <div className="header">{user?.name}</div>
      <div className="menu-screen">
        {!searching && matchEnabled && <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>}
        {searching && <button className="main-btn" onClick={handleCancelSearch}>検索をキャンセル</button>}
        {!matchEnabled && <div className="match-disabled">マッチング受付時間外です</div>}
        <button className="main-btn" onClick={handleLogout}>ログアウト</button>

        {/* 抽選当選者：ボタンで表示切替 */}
        {lotteryList.length > 0 && (
          <div style={{ marginTop:"15px" }}>
            <button className="main-btn" onClick={() => setShowLottery(!showLottery)}>
              {showLottery ? "抽選結果を隠す" : "抽選結果を表示"}
            </button>
            {showLottery && (
              <div style={{ marginTop:"10px", color:"yellow" }}>
                {isWinner && <p style={{ color:"red", fontWeight:"bold" }}>当選しました！</p>}
                <h4>抽選当選者一覧</h4>
                <ul>{lotteryList.map((u,i) => <li key={i}>{u.name}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {/* 対戦履歴：抽選結果ボタンの下に表示 */}
        {history.length > 0 && (
          <div className="history-list" style={{ marginTop:"15px" }}>
            <h4>対戦履歴</h4>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>相手</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{h.opponent}</td>
                    <td className={h.result === "勝ち" ? "win" : h.result === "負け" ? "lose" : ""}>
                      {h.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
export { socket };
