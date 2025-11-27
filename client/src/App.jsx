// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Socket.io 接続（自動再接続対応）
const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000",
  { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 }
);

function App() {
  // --- 状態 ---
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);

  const [lotteryList, setLotteryList] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [drawResult, setDrawResult] = useState([]);
  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]);
  const [showLottery, setShowLottery] = useState(false);
  const [lotteryHistory, setLotteryHistory] = useState([]);

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [autoLogoutHours, setAutoLogoutHours] = useState(12);
  const [activeMatches, setActiveMatches] = useState([]);

  // 勝利報告リトライ用
  const pendingWinReport = useRef(false);
  const loginAttempted = useRef(false);

  // --- 初期復元 & socket 登録 ---
  useEffect(() => {
    if (!loginAttempted.current) {
      // localStorage から復元
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");
      const savedHistory = localStorage.getItem("history");
      const savedLotteryHistory = localStorage.getItem("lotteryHistory");
      const savedLotteryList = localStorage.getItem("lotteryList");

      if (savedTitles) try { setLotteryWinnerTitles(JSON.parse(savedTitles)); } catch {}
      if (savedHistory) try { setHistory(JSON.parse(savedHistory)); } catch {}
      if (savedLotteryHistory) try { setLotteryHistory(JSON.parse(savedLotteryHistory)); } catch {}
      if (savedLotteryList) try { setLotteryList(JSON.parse(savedLotteryList)); } catch {}

      if (savedUser) {
        try {
          const u = JSON.parse(savedUser);
          setUser(u);
          setLoggedIn(true);
          setName(u.name);
          socket.emit("login", { name: u.name, sessionId: u.sessionId });
        } catch {}
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // --- Socket イベント登録 ---
    socket.on("connect", () => {
      // 再接続時に user 情報を送信して状態復元
      const saved = localStorage.getItem("user");
      if (saved) {
        try {
          const u = JSON.parse(saved);
          socket.emit("login", { name: u.name, sessionId: u.sessionId });
        } catch {}
      }
      // 未送信の勝利報告があれば再送
      if (pendingWinReport.current) {
        socket.emit("report_win_request");
        pendingWinReport.current = false;
      }
    });

    socket.on("login_ok", (u) => {
      const localHist = (() => { try { return JSON.parse(localStorage.getItem("history") || "[]"); } catch { return []; } })();
      const serverHist = Array.isArray(u.history) ? u.history : [];
      const finalHistory = serverHist.length >= localHist.length ? serverHist : localHist;

      const outUser = { ...u };
      setUser(outUser);
      setLoggedIn(true);
      setName(u.name);
      setSearching(u.status === "searching");
      setHistory(finalHistory);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : (prev => prev));
      setLotteryTitle("");

      try { localStorage.setItem("user", JSON.stringify(outUser)); } catch {}
      try { localStorage.setItem("history", JSON.stringify(finalHistory)); } catch {}

      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum);
      } else {
        setOpponent(null);
        setDeskNum(null);
      }
    });
// --- 永続化 ---
useEffect(() => { try { localStorage.setItem("history", JSON.stringify(history)); } catch(e) {} }, [history]);
useEffect(() => { try { localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles)); } catch(e) {} }, [lotteryWinnerTitles]);
useEffect(() => { try { localStorage.setItem("lotteryHistory", JSON.stringify(lotteryHistory)); } catch(e) {} }, [lotteryHistory]);
useEffect(() => { try { localStorage.setItem("lotteryList", JSON.stringify(lotteryList)); } catch(e) {} }, [lotteryList]);

// 管理者モード定期更新
useEffect(() => {
  if (!adminMode) return;
  const interval = setInterval(() => {
    socket.emit("admin_view_users");
    socket.emit("admin_get_lottery_history");
    socket.emit("admin_get_active_matches");
  }, 3000);
  return () => clearInterval(interval);
}, [adminMode]);

// --- ハンドラ ---
const handleLogin = () => {
  const trimmedName = name.trim();
  if (!trimmedName) return alert("ユーザー名を入力してください");
  const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch(e){ return {}; } })();
  const sessionId = saved?.sessionId || undefined;
  const recentOpponents = saved?.recentOpponents || [];
  socket.emit("login", { name: trimmedName, sessionId, history, recentOpponents });
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
  socket.emit("report_win_request"); 
};
const handleLogout = () => {
  if (!window.confirm("ログアウトしますか？")) return;
  socket.emit("logout");
  localStorage.clear();
  setUser(null); setLoggedIn(false); setSearching(false);
  setOpponent(null); setDeskNum(null);
  setLotteryWinnerTitles([]); setLotteryHistory([]); setLotteryList([]); setHistory([]); setName("");
};
// --- JSX ---
return (
  <div className="app">
    {!loggedIn && !adminMode ? (
      <div className="login-screen">
        <div className="user-login-center">
          <h2>ユーザーとしてログイン</h2>
          <input type="text" placeholder="ユーザー名" value={name} onChange={e => setName(e.target.value)} />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
        <div className="admin-login-topright">
          <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="管理者パスワード" />
          <button className="admin-btn" onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      </div>
    ) : adminMode ? (
      <div className="admin-screen">
        <div className="header">管理者画面</div>

        {/* --- マッチング --- */}
        <div className="admin-section">
          <button className="main-btn" onClick={() => socket.emit("admin_toggle_match", { enable: !matchEnabled })}>
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
          <label>
            抽選人数:
            <input type="number" min="1" value={drawCount} onChange={e => setDrawCount(Number(e.target.value))} />
          </label>
          <label>
            対戦数以上:
            <input type="number" min="0" value={minMatches} onChange={e => setMinMatches(Number(e.target.value))} />
          </label>
          <label>
            ログイン時間以上(時間):
            <input type="number" min="0" value={minLoginHours} onChange={e => setMinLoginHours(Number(e.target.value))} />
          </label>
          <button className="main-btn" onClick={() => socket.emit("admin_draw_lots", { count: drawCount, minBattles: minMatches, minLoginMinutes: minLoginHours*60, title: lotteryTitle })}>
            抽選する
          </button>
          <ul>
            {Array.isArray(drawResult) && drawResult.map((u, i) => <li key={i}>{u.name}</li>)}
          </ul>
        </div>

        {/* --- 抽選履歴 --- */}
        <div className="admin-section">
          <h3>抽選履歴</h3>
          {lotteryHistory.length === 0 ? (
            <p style={{ color: "lightgray" }}>まだ抽選履歴はありません</p>
          ) : (
            <>
              <table style={{ color: "white", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>抽選名</th>
                    <th>当選者</th>
                  </tr>
                </thead>
                <tbody>
                  {lotteryHistory.map((l, idx) => (
                    <tr key={idx}>
                      <td>{l.title}</td>
                      <td>
                        {(Array.isArray(l.winners) ? l.winners : []).map((w, i) => (
                          <span key={i}>{w.name}{i < l.winners.length - 1 ? ", " : ""}</span>
                        ))}
                        <button className="main-btn" style={{ marginLeft: "8px" }} onClick={() => handleDeleteLotteryEntry(idx)}>削除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: "10px" }}>
                <button className="main-btn" onClick={handleClearLotteryHistory}>抽選履歴をすべて削除</button>
              </div>
            </>
          )}
        </div>

        {/* --- 自動ログアウト設定 --- */}
        <div className="admin-section">
          <h3>自動ログアウト設定</h3>
          <label>
            ログインからの時間(時間):
            <input type="number" min="1" value={autoLogoutHours} onChange={e => setAutoLogoutHours(Number(e.target.value))} />
          </label>
          <button className="main-btn" onClick={() => { if(autoLogoutHours<=0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); }}>更新</button>
        </div>

        {/* --- ログイン中ユーザー --- */}
        <div className="admin-section">
          <h3>ログイン中のユーザー</h3>
          <table style={{ color: "white", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>番号</th>
                <th>名前</th>
                <th>対戦数</th>
                <th>勝</th>
                <th>敗</th>
                <th>ログイン時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {usersList.map((u, index) => {
                const win = u.history ? u.history.filter(h => h.result==="WIN").length : 0;
                const lose = u.history ? u.history.filter(h => h.result==="LOSE").length : 0;
                const loginTime = u.loginTime ? new Date(u.loginTime).toLocaleString() : "未ログイン";
                return (
                  <tr key={u.id}>
                    <td>{index+1}</td>
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

        {/* --- 対戦中部屋一覧 --- */}
        <div className="admin-section">
          <h3>対戦中の部屋</h3>
          {activeMatches.length === 0 ? <p style={{ color: "lightgray" }}>現在対戦中の部屋はありません</p> : (
            <table style={{ color: "white", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>卓番号</th>
                  <th>プレイヤー1</th>
                  <th>プレイヤー2</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {activeMatches.map((m, idx) => (
                  <tr key={idx}>
                    <td>{m.deskNum}</td>
                    <td>{m.player1?.name}</td>
                    <td>{m.player2?.name}</td>
                    <td>
                      <button className="main-btn" onClick={() => handleAdminReportWin(m.player1?.sessionId, m.deskNum)}>1勝登録</button>
                      <button className="main-btn" onClick={() => handleAdminReportWin(m.player2?.sessionId, m.deskNum)}>2勝登録</button>
                      <button className="main-btn" onClick={() => handleAdminReportBothLose(m.deskNum)}>両敗登録</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: "20px" }}>
          <button className="main-btn" onClick={handleAdminLogout}>ログイン画面に戻る</button>
        </div>
      </div>
    ) : opponent ? (
      <div className="battle-screen">
        <h3>対戦相手: {opponent.name}</h3>
        <div>卓番号: {deskNum}</div>
        <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
      </div>
    ) : (
      <div className="menu-screen">
        <div className="header">{user?.name}</div>
        {!searching && matchEnabled && <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>}
        {searching && <button className="main-btn" onClick={handleCancelSearch}>対戦相手を探しています…</button>}
        {!matchEnabled && <div className="match-disabled">マッチング時間外です</div>}

        {/* --- 抽選結果（ユーザー側で確認可能） --- */}
        <div style={{ marginTop: "15px", textAlign: "center" }}>
          <button className="main-btn" onClick={() => setShowLottery(!showLottery)}>
            {showLottery ? "抽選結果を閉じる" : "抽選結果"}
          </button>
          {showLottery && (
            <div style={{ marginTop: "10px", color: "yellow", textAlign: "left" }}>
              {(!lotteryList || lotteryList.length===0) ? (
                <p style={{ color: "lightgray" }}>発表されていません</p>
              ) : (
                <>
                  {lotteryWinnerTitles.slice().reverse().map((title, idx) => (
                    <p key={idx} style={{ color: "red", fontWeight: "bold" }}>「{title}」が当選しました！</p>
                  ))}

                  {lotteryList.slice().reverse().map((lottery, idx) => {
                    const title = lottery?.title || `抽選 ${idx+1}`;
                    const winners = Array.isArray(lottery?.winners) ? lottery.winners : (Array.isArray(lottery) ? lottery : []);
                    return (
                      <div key={idx} style={{ marginBottom: "10px" }}>
                        <h4>{title} 当選者一覧</h4>
                        <ul>
                          {(winners || []).map((w, i) => (
                            <li key={i}>{(w && (w.name || w)) ? (w.name || w) : "未登録"}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: "20px" }}>
          <h3>履歴</h3>
          {history.length === 0 ? (
            <p style={{ color: "lightgray" }}>まだ対戦履歴はありません</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>対戦相手</th>
                  <th>結果</th>
                  <th>日時</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, idx) => (
                  <tr key={idx}>
                    <td>{idx+1}</td>
                    <td>{h.opponent}</td>
                    <td className={h.result==="WIN"?"win":h.result==="LOSE"?"lose":""}>{h.result}</td>
                    <td>{h.endTime ? new Date(h.endTime).toLocaleString() : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
                   <div style={{ textAlign: "center", marginTop: "10px" }}>
            <button className="main-btn" onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}

export default App;

