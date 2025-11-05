// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000"
);

function App() {
  // --- State ---
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
  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]);
  const [showLottery, setShowLottery] = useState(false);
  const [autoLogoutHours, setAutoLogoutHours] = useState(12);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [activeMatches, setActiveMatches] = useState([]);

  const loginAttempted = useRef(false);

  // --- 初期復元 & Socketイベント登録 ---
  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");
      const savedHistory = localStorage.getItem("history");
      const savedLotteryHistory = localStorage.getItem("lotteryHistory");

      if (savedTitles) setLotteryWinnerTitles(JSON.parse(savedTitles));
      if (savedHistory) setHistory(JSON.parse(savedHistory));
      if (savedLotteryHistory) setLotteryHistory(JSON.parse(savedLotteryHistory));

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

    // --- Socket.io イベント ---
    socket.on("login_ok", (u) => {
      const localHist = JSON.parse(localStorage.getItem("history") || "[]");
      const serverHist = Array.isArray(u.history) ? u.history : [];
      const finalHistory = serverHist.length >= localHist.length ? serverHist : localHist;
      const lotteryListFromServer = Array.isArray(u.lotteryList) ? u.lotteryList : [];

      const outUser = { ...u };
      setUser(outUser);
      setLoggedIn(true);
      setName(u.name);
      setSearching(u.status === "searching");
      setHistory(finalHistory);
      setLotteryList(lotteryListFromServer);
      setLotteryTitle("");

      try { localStorage.setItem("user", JSON.stringify(outUser)); } catch {}
      try { localStorage.setItem("history", JSON.stringify(finalHistory)); } catch {}

      // サーバに履歴同期
      try {
        socket.emit("sync_history", {
          sessionId: outUser.sessionId,
          history: finalHistory,
          recentOpponents: outUser.recentOpponents || [],
        });
      } catch {}

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
      localStorage.removeItem("lotteryHistory");
      localStorage.removeItem("history");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setLotteryHistory([]);
      setHistory([]);
      setName("");
    });

    socket.on("history", (hist) => {
      setHistory(Array.isArray(hist) ? hist : []);
      try { localStorage.setItem("history", JSON.stringify(hist)); } catch {}
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
      socket.emit("admin_get_auto_logout");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_get_active_matches");
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

    socket.on("admin_set_lottery_title_ok", ({ title }) => {
      if (title) setLotteryTitle(title);
    });

    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinnerTitles((prev) => {
        if (!prev.includes(title)) return [...prev, title];
        return prev;
      });
    });

    socket.on("update_lottery_list", ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      setLotteryList(list);
      setShowLottery(true);
    });

    socket.on("admin_lottery_history", (list) => {
      setLotteryHistory(list);
      try { localStorage.setItem("lotteryHistory", JSON.stringify(list)); } catch {}
    });

    socket.on("admin_active_matches", (list) => setActiveMatches(list));

    socket.on("confirm_opponent_win", ({ deskNum: dn, winnerName } = {}) => {
      const confirmLose = window.confirm((winnerName ? `${winnerName} の勝ちで` : "対戦相手の勝ちで") + "登録します。よろしいですか？");
      socket.emit("opponent_win_confirmed", { accepted: confirmLose });
      alert(confirmLose ? "勝敗が登録されました" : "勝敗登録がキャンセルされました");
    });

    socket.on("win_report_cancelled", () => {
      alert("対戦相手がキャンセルしたため、勝利登録は中止されました");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    return () => socket.off();
  }, [user]);

  // --- 履歴 & lottery 永続化 ---
  useEffect(() => { try { localStorage.setItem("history", JSON.stringify(history)); } catch {} }, [history]);
  useEffect(() => { try { localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles)); } catch {} }, [lotteryWinnerTitles]);
  useEffect(() => { try { localStorage.setItem("lotteryHistory", JSON.stringify(lotteryHistory)); } catch {} }, [lotteryHistory]);

  // 管理者定期更新
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

    const saved = JSON.parse(localStorage.getItem("user") || "{}");
    socket.emit("login", {
      name: trimmedName,
      sessionId: saved?.sessionId,
      history,
      recentOpponents: saved?.recentOpponents || [],
    });
  };

  const handleAdminLogin = () => { if (!adminPassword) return; socket.emit("admin_login", { password: adminPassword }); };
  const handleAdminLogout = () => { if (!window.confirm("ログイン画面に戻りますか？")) return; setAdminMode(false); localStorage.removeItem("adminMode"); };
  const handleFindOpponent = () => { if (!matchEnabled) return; setSearching(true); socket.emit("find_opponent"); };
  const handleCancelSearch = () => { setSearching(false); socket.emit("cancel_find"); };
  const handleWinReport = () => { if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return; socket.emit("report_win_request"); };
  const handleLogout = () => { if (!window.confirm("ログアウトしますか？")) return; socket.emit("logout"); localStorage.clear(); setUser(null); setLoggedIn(false); setSearching(false); setOpponent(null); setDeskNum(null); setLotteryWinnerTitles([]); setLotteryHistory([]); setHistory([]); setName(""); };

  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount, minBattles: minMatches, minLoginMinutes: minLoginHours * 60, title: lotteryTitle });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => { if (autoLogoutHours <= 0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); };
  const handleLogoutUser = (userId, userName) => { if (!window.confirm(`${userName} をログアウトさせますか？`)) return; socket.emit("admin_logout_user", { userId }); };
  const handleAdminReportWin = (winnerSessionId, deskNum) => { if (!window.confirm("この部屋の勝者を登録しますか？")) return; socket.emit("admin_report_win", { winnerSessionId, deskNum }); };
  const handleAdminReportBothLose = (deskNum) => { if (!window.confirm("この部屋の両者を敗北として登録しますか？")) return; socket.emit("admin_report_both_lose", { deskNum }); };
  const handleDeleteLotteryEntry = (index) => { const entry = lotteryHistory[index]; if (!entry) return; if (!window.confirm(`抽選「${entry.title}」の履歴を削除しますか？`)) return; const next = [...lotteryHistory]; next.splice(index,1); setLotteryHistory(next); try { localStorage.setItem("lotteryHistory", JSON.stringify(next)); } catch {} socket.emit("admin_delete_lottery_history", { title: entry.title, index }); };
  const handleClearLotteryHistory = () => { if (!window.confirm("抽選履歴をすべて削除しますか？")) return; setLotteryHistory([]); try { localStorage.removeItem("lotteryHistory"); } catch {} socket.emit("admin_clear_lottery_history"); };

  const displayHistory = history || [];

  // --- Render ---
  return (
    <div className="app">
      {!loggedIn && !adminMode ? (
        <div className="login-screen">
          <div className="user-login-center">
            <h2>ユーザーとしてログイン</h2>
            <input type="text" placeholder="ユーザー名" value={name} onChange={(e)=>setName(e.target.value)} />
            <button className="main-btn" onClick={handleLogin}>ログイン</button>
          </div>
          <div className="admin-login-topright">
            <input type="password" value={adminPassword} onChange={(e)=>setAdminPassword(e.target.value)} placeholder="管理者パスワード"/>
            <button className="admin-btn" onClick={handleAdminLogin}>管理者ログイン</button>
          </div>
        </div>
      ) : adminMode ? (
        <AdminScreen
          matchEnabled={matchEnabled}
          handleToggleMatch={handleToggleMatch}
          lotteryTitle={lotteryTitle}
          setLotteryTitle={setLotteryTitle}
          drawCount={drawCount}
          setDrawCount={setDrawCount}
          minMatches={minMatches}
          setMinMatches={setMinMatches}
          minLoginHours={minLoginHours}
          setMinLoginHours={setMinLoginHours}
          handleDrawLots={handleDrawLots}
          lotteryHistory={lotteryHistory}
          setLotteryHistory={setLotteryHistory}
          handleDeleteLotteryEntry={handleDeleteLotteryEntry}
          handleClearLotteryHistory={handleClearLotteryHistory}
          usersList={usersList}
          handleLogoutUser={handleLogoutUser}
          activeMatches={activeMatches}
          handleAdminReportWin={handleAdminReportWin}
          handleAdminReportBothLose={handleAdminReportBothLose}
          autoLogoutHours={autoLogoutHours}
          setAutoLogoutHours={setAutoLogoutHours}
          handleUpdateAutoLogout={handleUpdateAutoLogout}
          handleAdminLogout={handleAdminLogout}
          drawResult={drawResult}
          lotteryWinnerTitles={lotteryWinnerTitles}
        />
      ) : opponent ? (
        <BattleScreen opponent={opponent} deskNum={deskNum} handleWinReport={handleWinReport} />
      ) : (
        <MenuScreen
          user={user}
          matchEnabled={matchEnabled}
          searching={searching}
          handleFindOpponent={handleFindOpponent}
          handleCancelSearch={handleCancelSearch}
          lotteryList={lotteryList}
          showLottery={showLottery}
          setShowLottery={setShowLottery}
          lotteryWinnerTitles={lotteryWinnerTitles}
          displayHistory={displayHistory}
          handleLogout={handleLogout}
        />
      )}
    </div>
  );
}

export default App;
