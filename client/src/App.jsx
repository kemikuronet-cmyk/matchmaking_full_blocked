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

  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]); // ユーザーが当選したタイトル一覧
  const [showLottery, setShowLottery] = useState(false);

  const [autoLogoutHours, setAutoLogoutHours] = useState(12);

  const [lotteryHistory, setLotteryHistory] = useState([]); // 管理者用抽選履歴

  // --- 追加: 管理者用対戦中部屋一覧 ---
  const [rooms, setRooms] = useState([]);

  const loginAttempted = useRef(false);

  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");

      // ★ localStorage から当選履歴を復元
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");
      if (savedTitles) {
        setLotteryWinnerTitles(JSON.parse(savedTitles));
      }

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
      setLotteryTitle("");
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
      localStorage.removeItem("lotteryWinnerTitles");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setName("");
    });

    socket.on("history", (hist) => setHistory(hist));
    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
      socket.emit("admin_get_auto_logout");
      socket.emit("admin_get_lottery_history");
    });
    socket.on("admin_fail", () => alert("パスワードが間違っています"));
    socket.on("admin_user_list", (list) => setUsersList(list));
    socket.on("admin_draw_result", (res) => {
      if (res && res.title) setLotteryTitle(res.title);
      setDrawResult(res?.winners || []);
      socket.emit("admin_get_lottery_history");
    });
    socket.on("admin_current_auto_logout", ({ hours }) => setAutoLogoutHours(hours));
    socket.on("admin_set_auto_logout_ok", ({ hours }) => {
      setAutoLogoutHours(hours);
      alert(`自動ログアウト時間を ${hours} 時間に設定しました`);
    });

    // --- 抽選更新イベント ---
    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinnerTitles(prev => {
        if (!prev.includes(title)) return [...prev, title];
        return prev;
      });
    });

    socket.on("update_lottery_list", ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      setLotteryList(list);
      setShowLottery(true);
    });

    socket.on("admin_lottery_history", (list) => setLotteryHistory(list));

    // --- 新規: 管理者用対戦中部屋一覧 ---
    socket.on("admin_room_list", (list) => setRooms(list));

    return () => socket.off();
  }, [user]);

  // ★ 当選履歴が変わるたび localStorage に保存
  useEffect(() => {
    localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles));
  }, [lotteryWinnerTitles]);

  useEffect(() => {
    if (!adminMode) return;
    const interval = setInterval(() => {
      socket.emit("admin_view_users");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_room_list"); // 追加: 部屋一覧定期取得
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
    localStorage.removeItem("lotteryWinnerTitles");
    setUser(null);
    setLoggedIn(false);
    setSearching(false);
    setOpponent(null);
    setDeskNum(null);
    setLotteryWinnerTitles([]);
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

  // --- 新規: 管理者用勝利報告 ---
  const handleAdminReportWin = (deskNum, winnerId) => {
    if (!window.confirm("このプレイヤーを勝者として登録しますか？")) return;
    socket.emit("admin_report_win", { deskNum, winnerId });
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
          {/* 既存: マッチング、抽選、抽選履歴、自動ログアウト、ユーザー一覧、管理者ログアウト */}

          {/* --- 新規: 対戦中の部屋一覧 --- */}
          <div className="admin-section">
            <h3>対戦中の部屋一覧</h3>
            {rooms.length === 0 ? (
              <p style={{ color: "lightgray" }}>現在対戦中の部屋はありません</p>
            ) : (
              rooms.map((room) => (
                <div key={room.deskNum} style={{ marginBottom: "10px", border: "1px solid white", padding: "5px" }}>
                  <strong>卓番号: {room.deskNum}</strong>
                  <ul>
                    {room.players.map((p) => (
                      <li key={p.id}>
                        {p.name}{" "}
                        <button
                          className="main-btn"
                          style={{ marginLeft: "5px" }}
                          onClick={() => handleAdminReportWin(room.deskNum, p.id)}
                        >
                          勝利報告
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {/* 以下、既存の管理者画面コードはそのまま */}
          {/* ... */}
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
                    {lotteryWinnerTitles.slice().reverse().map((title, idx) => (
                      <p key={idx} style={{ color:"red", fontWeight:"bold" }}>
                        「{title}」が当選しました！
                      </p>
                    ))}
                    {lotteryList.slice().reverse().map((lottery, idx) => (
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
