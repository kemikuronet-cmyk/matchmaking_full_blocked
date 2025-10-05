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
  const [lotteryList, setLotteryList] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);

  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [drawResult, setDrawResult] = useState([]);

  const [lotteryWinner, setLotteryWinner] = useState(false);
  const [showLottery, setShowLottery] = useState(false);

  const [autoLogoutHours, setAutoLogoutHours] = useState(12);

  const loginAttempted = useRef(false);

  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      if (savedUser) {
        const u = JSON.parse(savedUser);
        setUser(u);
        setLoggedIn(true);
        setName(u.name);
        socket.emit("login", { name: u.name, sessionId: u.sessionId });
      }
      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      setName(u.name);
      localStorage.setItem("user", JSON.stringify(u));
      setSearching(u.status === "searching");
      setHistory(u.history || []);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : []);
      setLotteryTitle(u.lotteryTitle || "");
      setLotteryWinner(false);
      if ((u.lotteryList || []).length > 0) setShowLottery(false);
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

    socket.on("force_logout", ({ reason }) => {
      if (reason === "auto") alert("一定時間が経過したため、自動ログアウトされました。");
      localStorage.removeItem("user");
      localStorage.removeItem("adminMode");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinner(false);
      setName("");
    });

    socket.on("history", (hist) => setHistory(hist));
    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
      socket.emit("admin_get_auto_logout");
    });
    socket.on("admin_fail", () => alert("パスワードが間違っています"));
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => {
      if (res && res.title) setLotteryTitle(res.title);
      setDrawResult(res?.winners || []);
    });
    socket.on("admin_current_auto_logout", ({ hours }) => setAutoLogoutHours(hours));
    socket.on("admin_set_auto_logout_ok", ({ hours }) => {
      setAutoLogoutHours(hours);
      alert(`自動ログアウト時間を ${hours} 時間に設定しました`);
    });

    // --- 抽選更新イベント（常に最新） ---
    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinner(true);
      setLotteryTitle(title || "");
    });
    socket.on("update_lottery_list", ({ list, title }) => {
      if (!list || !Array.isArray(list)) return;
      setLotteryList(list);
      setLotteryTitle(title || "");
      setShowLottery(true);
      // 自分がどの抽選に当たったか確認
      const isWinner = list.some(item =>
        Array.isArray(item.winners) && item.winners.some(w => w?.name === user?.name)
      );
      setLotteryWinner(isWinner);
    });

    return () => socket.off();
  }, [user]);

  useEffect(() => {
    if (!adminMode) return;
    const interval = setInterval(() => {
      socket.emit("admin_view_users");
    }, 3000);
    return () => clearInterval(interval);
  }, [adminMode]);

  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    socket.emit("login", { name: trimmedName });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleAdminLogout = () => {
    if (!window.confirm("ログイン画面に戻りますか？")) return;
    setAdminMode(false);
    localStorage.removeItem("adminMode");
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
    socket.emit("request_history");
    socket.emit("admin_view_users");
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    localStorage.removeItem("adminMode");
    setUser(null);
    setLoggedIn(false);
    setSearching(false);
    setOpponent(null);
    setDeskNum(null);
    setLotteryWinner(false);
    setName("");
  };

  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => {
    socket.emit("admin_draw_lots", { 
      count: drawCount,
      minBattles: minMatches,
      minLoginMinutes: minLoginHours * 60
    });
  };
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => {
    if (autoLogoutHours <= 0.01) {
      alert("1時間以上を指定してください");
      return;
    }
    socket.emit("admin_set_auto_logout", { hours: autoLogoutHours });
  };
  const handleLogoutUser = (userId, userName) => {
    if (!window.confirm(`${userName} をログアウトさせますか？`)) return;
    socket.emit("admin_logout_user", { userId });
  };

  // --- レンダリング ---
  if (!loggedIn && !adminMode) {
    return (
      <div className="login-screen">
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <input type="text" placeholder="ユーザー名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
        <div className="admin-login-topright">
          <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="管理者パスワード" />
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
          {/* --- マッチング --- */}
          <div className="admin-section">
            <button className="main-btn" onClick={handleToggleMatch}>
              {matchEnabled ? "マッチング中" : "マッチング開始"}
            </button>
          </div>

          {/* --- 抽選 --- */}
          <div className="admin-section">
            <h3>抽選</h3>
            <label>
              抽選名:
              <input type="text" value={lotteryTitle} onChange={e => setLotteryTitle(e.target.value)} />
              <button className="main-btn" onClick={() => socket.emit("admin_set_lottery_title", { title: lotteryTitle })}>設定</button>
            </label>
            <label>抽選人数: <input type="number" min="1" value={drawCount} onChange={e => setDrawCount(Number(e.target.value))}/></label>
            <label>対戦数以上: <input type="number" min="0" value={minMatches} onChange={e => setMinMatches(Number(e.target.value))}/></label>
            <label>ログイン時間以上(時間): <input type="number" min="0" value={minLoginHours} onChange={e => setMinLoginHours(Number(e.target.value))}/></label>
            <button className="main-btn" onClick={handleDrawLots}>抽選する</button>
            <ul>
              {Array.isArray(drawResult) && drawResult.map((u,i) => <li key={i}>{u.name}</li>)}
            </ul>
          </div>

          {/* --- 自動ログアウト設定 --- */}
          <div className="admin-section">
            <h3>自動ログアウト設定</h3>
            <label>
              ログインからの時間(時間):
              <input type="number" min="1" value={autoLogoutHours} onChange={(e) => setAutoLogoutHours(Number(e.target.value))} />
            </label>
            <button className="main-btn" onClick={handleUpdateAutoLogout}>更新</button>
          </div>

          {/* --- ユーザー一覧 --- */}
          <div className="admin-section">
            <h3>ログイン中のユーザー</h3>
            <table style={{ color: "white", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>番号</th><th>名前</th><th>対戦数</th><th>勝</th><th>敗</th><th>ログイン時間</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u, index) => {
                  const win = u.history ? u.history.filter(h => h.result === "WIN").length : 0;
                  const lose = u.history ? u.history.filter(h => h.result === "LOSE").length : 0;
                  const loginTime = u.loginTime ? new Date(u.loginTime).toLocaleString() : "未ログイン";
                  return (
                    <tr key={u.id}>
                      <td>{index + 1}</td>
                      <td>{u.name}</td>
                      <td>{u.history?.length || 0}</td>
                      <td>{win}</td>
                      <td>{lose}</td>
                      <td>{loginTime}</td>
                      <td>
                        <button className="main-btn" onClick={() => handleLogoutUser(u.id, u.name)}>ログアウト</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="main-btn" onClick={handleAdminLogoutAll}>全ユーザーをログアウト</button>
          </div>

          {/* --- 管理者モード解除 --- */}
          <div className="admin-section">
            <button className="main-btn" onClick={handleAdminLogout}>管理者画面からログアウト</button>
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

  const displayHistory = history || [];

  return (
    <div className="app">
      <div className="header">{user?.name}</div>
      <div className="menu-screen">
        {!searching && matchEnabled && <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>}
        {searching && <button className="main-btn" onClick={handleCancelSearch}>対戦相手を探しています…</button>}
        {!matchEnabled && <div className="match-disabled">マッチング時間外です</div>}
        <button className="main-btn" onClick={handleLogout}>ログアウト</button>

{lotteryList && Array.isArray(lotteryList) && (
  <div style={{ marginTop:"15px" }}>
    <button className="main-btn" onClick={() => setShowLottery(!showLottery)}>
      {showLottery ? "抽選結果を閉じる" : "抽選結果"}
    </button>
    {showLottery && (
      <div style={{ marginTop:"10px", color:"yellow" }}>
        {lotteryList.length === 0 ? (
          <p style={{ color:"lightgray" }}>発表されていません</p>
        ) : (
          <>
            {/* 🎯 当選メッセージを一番上に表示 */}
            {lotteryWinner && (
              <p style={{ color:"red", fontWeight:"bold" }}>
                「{lotteryTitle || "抽選"}」に当選しました！
              </p>
            )}

            {lotteryList.map((lottery, idx) => (
              <div key={idx} style={{ marginBottom:"10px" }}>
                <h4>{lottery?.title || "抽選"} 当選者一覧</h4>
                <ul>
                  {(Array.isArray(lottery?.winners) ? lottery.winners : []).map((w, i) => (
                    <li key={i}>{w?.name || "未登録"}</li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    )}
  </div>
)}


        <div style={{ marginTop: lotteryList.length > 0 ? "15px" : "0px" }}>
          <div className="history-list">
            <h4>対戦履歴</h4>
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>相手</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {displayHistory.map((h, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{h.opponent}</td>
                    <td className={h.result === "WIN" ? "win" : h.result === "LOSE" ? "lose" : ""}>{h.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
export { socket };
