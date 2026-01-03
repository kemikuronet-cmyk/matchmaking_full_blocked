// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : (import.meta.env.VITE_SERVER_URL || "http://localhost:4000");

const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  transports: ["websocket", "polling"],
});

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

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
  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [autoLogoutHours, setAutoLogoutHours] = useState(12);
  const [desks, setDesks] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);

  const loginAttempted = useRef(false);
  const heartbeatTimer = useRef(null);

  // sessionId 初回生成
  useEffect(() => {
    let sid = localStorage.getItem("sessionId");
    if (!sid) {
      sid = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      localStorage.setItem("sessionId", sid);
    }
  }, []);

  // 初期復元 & socket 登録
  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedLotteryWinnerTitles = localStorage.getItem("lotteryWinnerTitles");
      const savedHistory = localStorage.getItem("history");
      const savedLotteryHistory = localStorage.getItem("lotteryHistory");
      const savedLotteryList = localStorage.getItem("lotteryList");

      if (savedLotteryWinnerTitles) try { setLotteryWinnerTitles(JSON.parse(savedLotteryWinnerTitles)); } catch {}
      if (savedHistory) try { setHistory(JSON.parse(savedHistory)); } catch {}
      if (savedLotteryHistory) try { setLotteryHistory(JSON.parse(savedLotteryHistory)); } catch {}
      if (savedLotteryList) try { setLotteryList(JSON.parse(savedLotteryList)); } catch {}

      if (savedUser) {
        try {
          const u = JSON.parse(savedUser);
          setUser(u); setLoggedIn(true); setName(u.name);
          const sid = u.sessionId || localStorage.getItem("sessionId");
          if (sid) socket.emit("login", { name: u.name, sessionId: sid });
        } catch {}
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // socket イベント登録
    const onLoginOk = (data) => { setUser(data); setLoggedIn(true); localStorage.setItem("user", JSON.stringify(data)); };
    const onMatched = (data) => { setOpponent(data.opponent); setDeskNum(data.deskNum); setSearching(false); };
    const onReturnToMenu = () => { setOpponent(null); setDeskNum(null); setSearching(false); };
    const onForceLogout = () => { setUser(null); setLoggedIn(false); setOpponent(null); setDeskNum(null); localStorage.removeItem("user"); };
    const onHistory = (data) => { setHistory(data); localStorage.setItem("history", JSON.stringify(data)); };
    const onMatchStatus = (data) => { setMatchEnabled(data.enabled); };
    const onAdminUserList = (data) => { setUsersList(data); };
    const onLotteryWinner = (data) => { setLotteryWinnerTitles(prev => [...prev, data]); };
    const onUpdateLotteryList = (data) => { setLotteryList(data); };
    const onAdminLotteryHistory = (data) => { setLotteryHistory(data); };
    const onAdminActiveMatches = (data) => { setDesks(data); };
    const onAdminDrawResult = (data) => { setLotteryResults(data); };

    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("force_logout", onForceLogout);
    socket.on("history", onHistory);
    socket.on("match_status", onMatchStatus);
    socket.on("admin_user_list", onAdminUserList);
    socket.on("lottery_winner", onLotteryWinner);
    socket.on("update_lottery_list", onUpdateLotteryList);
    socket.on("admin_lottery_history", onAdminLotteryHistory);
    socket.on("admin_active_matches", onAdminActiveMatches);
    socket.on("admin_draw_result", onAdminDrawResult);

    // heartbeat
    heartbeatTimer.current = setInterval(() => {
      const sid = localStorage.getItem("sessionId");
      if (sid && socket.connected) socket.emit("heartbeat", { sessionId: sid });
    }, HEARTBEAT_INTERVAL);

    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("force_logout", onForceLogout);
      socket.off("history", onHistory);
      socket.off("match_status", onMatchStatus);
      socket.off("admin_user_list", onAdminUserList);
      socket.off("lottery_winner", onLotteryWinner);
      socket.off("update_lottery_list", onUpdateLotteryList);
      socket.off("admin_lottery_history", onAdminLotteryHistory);
      socket.off("admin_active_matches", onAdminActiveMatches);
      socket.off("admin_draw_result", onAdminDrawResult);
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
    };
  }, []);

  // -------------------------
  // ハンドラ関数（全ボタン対応）
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } })();
    const sessionId = saved?.sessionId || localStorage.getItem("sessionId");
    const recentOpponents = saved?.recentOpponents || [];
    socket.emit("login", { name: trimmedName, sessionId, history, recentOpponents });
  };

  const handleAdminLogin = () => { if (!adminPassword) return; socket.emit("admin_login", { password: adminPassword }); };
  const handleAdminLogout = () => { if (!window.confirm("ログイン画面に戻りますか？")) return; setAdminMode(false); localStorage.removeItem("adminMode"); };
  const handleFindOpponent = () => { if (!matchEnabled) return; setSearching(true); socket.emit("find_opponent"); };
  const handleCancelSearch = () => { setSearching(false); socket.emit("cancel_find"); };
  const handleWinReport = () => { if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return; socket.emit("report_win_request"); };
  const handleLogout = () => { if (!window.confirm("ログアウトしますか？")) return; socket.emit("logout"); localStorage.clear(); setUser(null); setLoggedIn(false); setSearching(false); setOpponent(null); setDeskNum(null); setLotteryWinnerTitles([]); setLotteryHistory([]); setLotteryList([]); setHistory([]); setName(""); };

  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount || 1, minBattles: minMatches || 0, minLoginMinutes: (minLoginHours || 0) * 60, title: lotteryTitle });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => { if ((autoLogoutHours || 0) <= 0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); };
  const handleLogoutUser = (userId, userName) => { if (!window.confirm(`${userName} をログアウトさせますか？`)) return; socket.emit("admin_logout_user", { userId }); };
  const handleAdminReportWin = (winnerSessionId, deskNum) => { if (!window.confirm("この部屋の勝者を登録しますか？")) return; socket.emit("admin_report_win", { winnerSessionId, deskNum }); };
  const handleAdminReportBothLose = (deskNum) => { if (!window.confirm("この部屋の両者を敗北として登録しますか？")) return; socket.emit("admin_report_both_lose", { deskNum }); };

  const handleDeleteLotteryEntry = (index) => {
    const entry = lotteryHistory[index];
    if (!entry) return;
    if (!window.confirm(`抽選「${entry.title}」の履歴を削除しますか？`)) return;
    setLotteryHistory(prev => {
      const next = [...prev]; next.splice(index,1); try { localStorage.setItem("lotteryHistory", JSON.stringify(next)); } catch {}; return next;
    });
    socket.emit("admin_delete_lottery_history", { title: entry.title, index });
  };

  const handleClearLotteryHistory = () => {
    if (!window.confirm("抽選履歴をすべて削除しますか？")) return;
    setLotteryHistory([]); try { localStorage.removeItem("lotteryHistory"); } catch {};
    socket.emit("admin_clear_lottery_history");
  };

  const userWins = (history || []).filter(h => h.result==="WIN").length;
  const userLosses = (history || []).filter(h => h.result==="LOSE").length;
  const userMatches = (history || []).length;

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="main-container">
      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>
          <div className="admin-controls">
            <button onClick={handleToggleMatch}>{matchEnabled ? "マッチング無効化" : "マッチング有効化"}</button>
            <button onClick={handleAdminLogoutAll}>全ユーザー強制ログアウト</button>
          </div>
          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length===0 ? <p>現在、稼働中の卓はありません</p> :
              <ul>{desks.map(d=>(
                <li key={d.deskNum}>
                  <strong>卓 {d.deskNum}</strong>：{d.players?.map(p=>p.name).join(" vs ")}
                  <button onClick={()=>handleAdminReportWin(d.winnerSessionId,d.deskNum)}>勝者登録</button>
                  <button onClick={()=>handleAdminReportBothLose(d.deskNum)}>両者敗北登録</button>
                  <button onClick={()=>handleLogoutUser(d.userId,d.userName)}>卓削除</button>
                </li>
              ))}</ul>}
          </div>
          <div className="lottery-admin-section">
            <h3>抽選機能</h3>
            <input type="text" placeholder="抽選タイトル" value={lotteryTitle} onChange={e=>setLotteryTitle(e.target.value)} />
            <input type="number" placeholder="当選人数" value={drawCount} onChange={e=>setDrawCount(Number(e.target.value))} />
            <button onClick={handleDrawLots}>抽選実行</button>
            <button onClick={handleClearLotteryHistory}>抽選履歴全削除</button>
            {lotteryResults.length===0 ? <p>抽選履歴なし</p> :
              <ul>{lotteryResults.map((lot,i)=><li key={i}><strong>{lot.title}</strong><ul>{lot.winners?.map((w,j)=><li key={j}>{w.name}</li>)}</ul></li>)}</ul>}
          </div>
          <button onClick={handleAdminLogout}>ログアウト</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {!adminMode && user && (
        <div className="user-menu">
          <h2>ようこそ {user.name} さん</h2>
          <div className="user-stats">
            <p>勝ち：{userWins}</p>
            <p>負け：{userLosses}</p>
            <p>対戦数：{userMatches}</p>
          </div>
          {!opponent && !deskNum ? (
            <div className="match-controls">
              {!searching ? <button onClick={handleFindOpponent}>マッチング開始</button>
                          : <button onClick={handleCancelSearch}>キャンセル</button>}
            </div>
          ) : (
            <div className="battle-info">
              <h3>対戦相手：{opponent?.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button onClick={handleWinReport}>勝利報告</button>
            </div>
          )}
          <div className="history-section">
            <h3>対戦履歴</h3>
            {history.length===0 ? <p>対戦履歴がありません</p> :
              <ul>{history.map((h,i)=><li key={i}><strong>{h.opponent}</strong>：{h.result}</li>)}</ul>}
          </div>
          <div className="lottery-user-section">
            <h3>抽選結果</h3>
            {lotteryHistory.length===0 ? <p>抽選履歴なし</p> :
              <ul>{lotteryHistory.map((entry,i)=>
                <li key={i}><strong>{entry.title}</strong>
                  <ul>{entry.winners?.map((w,j)=>
                    <li key={j} style={w.id===user.id ? {color:"red", fontWeight:"bold"} : {}}>{w.name}{w.id===user.id?"（当選）":""}</li>
                  )}</ul>
                </li>
              )}</ul>}
          </div>
          <button onClick={handleLogout}>ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
