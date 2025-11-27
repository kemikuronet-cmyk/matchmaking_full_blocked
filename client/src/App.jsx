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

  const loginAttempted = useRef(false);

  // --- 初期復元 & socket 登録 ---
  useEffect(() => {
    if (!loginAttempted.current) {
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

    // --- socket.on イベント ---
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

    socket.on("confirm_opponent_win", ({ deskNum: dn, winnerName } = {}) => {
      const msg = (winnerName ? `${winnerName} の勝ちで` : "対戦相手の勝ちで") + "登録します。よろしいですか？";
      const accept = window.confirm(msg);
      socket.emit("opponent_win_confirmed", { accepted: accept });
      alert(accept ? "勝敗が登録されました" : "勝敗登録がキャンセルされました");
    });

    socket.on("win_report_cancelled", () => {
      alert("対戦相手がキャンセルしたため、勝利登録は中止されました");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    socket.on("force_logout", ({ reason }) => {
      if (reason === "auto") alert("一定時間が経過したため、自動ログアウトされました");
      localStorage.clear();
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setLotteryHistory([]);
      setLotteryList([]);
      setHistory([]);
      setName("");
    });

    socket.on("history", (hist) => {
      const h = Array.isArray(hist) ? hist : [];
      setHistory(h);
      try { localStorage.setItem("history", JSON.stringify(h)); } catch (e) {}
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
      socket.emit("admin_view_users");
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
    socket.on("admin_set_auto_logout_ok", ({ hours }) => { setAutoLogoutHours(hours); alert(`自動ログアウト時間を ${hours} 時間に設定しました`); });
    socket.on("admin_set_lottery_title_ok", ({ title }) => { if (title) setLotteryTitle(title); });

    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinnerTitles((prev) => prev.includes(title) ? prev : [...prev, title]);
    });

    socket.on("update_lottery_list", ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      let normalized = [];
      const looksLikeHistory = list.every(item => item && (item.title || item.winners));
      if (looksLikeHistory) normalized = list;
      else normalized = [{ title: lotteryTitle || "抽選", winners: list.map(w => (typeof w === "string" ? { name: w } : (w || {}))) }];
      setLotteryList(normalized);
      try { localStorage.setItem("lotteryList", JSON.stringify(normalized)); } catch (e) {}
      setShowLottery(true);
    });

    socket.on("admin_lottery_history", (list) => {
      setLotteryHistory(list);
      try { localStorage.setItem("lotteryHistory", JSON.stringify(list)); } catch (e) {}
    });

    socket.on("admin_active_matches", (list) => setActiveMatches(list));

    return () => socket.off();
  }, [user, lotteryTitle]);

  // --- 永続化 ---
  useEffect(() => { try { localStorage.setItem("history", JSON.stringify(history)); } catch(e) {} }, [history]);
  useEffect(() => { try { localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles)); } catch(e) {} }, [lotteryWinnerTitles]);
  useEffect(() => { try { localStorage.setItem("lotteryHistory", JSON.stringify(lotteryHistory)); } catch(e) {} }, [lotteryHistory]);
  useEffect(() => { try { localStorage.setItem("lotteryList", JSON.stringify(lotteryList)); } catch(e) {} }, [lotteryList]);

  // --- 管理者モード定期更新 ---
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
  const handleAdminLogin = () => { if (!adminPassword) return; socket.emit("admin_login", { password: adminPassword }); };
  const handleAdminLogout = () => { if (!window.confirm("ログイン画面に戻りますか？")) return; setAdminMode(false); localStorage.removeItem("adminMode"); };
  const handleFindOpponent = () => { if (!matchEnabled) return; setSearching(true); socket.emit("find_opponent"); };
  const handleCancelSearch = () => { setSearching(false); socket.emit("cancel_find"); };
  const handleWinReport = () => { if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return; socket.emit("report_win_request"); };
  const handleLogout = () => { if (!window.confirm("ログアウトしますか？")) return; socket.emit("logout"); localStorage.clear(); setUser(null); setLoggedIn(false); setSearching(false); setOpponent(null); setDeskNum(null); setLotteryWinnerTitles([]); setLotteryHistory([]); setLotteryList([]); setHistory([]); setName(""); };
  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount, minBattles: minMatches, minLoginMinutes: minLoginHours * 60, title: lotteryTitle });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => { if (autoLogoutHours <= 0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); };
  const handleLogoutUser = (userId, userName) => { if (!window.confirm(`${userName} をログアウトさせますか？`)) return; socket.emit("admin_logout_user", { userId }); };
  const handleAdminReportWin = (winnerSessionId, deskNum) => { if (!window.confirm("この部屋の勝者を登録しますか？")) return; socket.emit("admin_report_win", { winnerSessionId, deskNum }); };
  const handleAdminReportBothLose = (deskNum) => { if (!window.confirm("この部屋の両者を敗北として登録しますか？")) return; socket.emit("admin_report_both_lose", { deskNum }); };
  const handleDeleteLotteryEntry = (index) => {
    const entry = lotteryHistory[index];
    if (!entry) return;
    if (!window.confirm(`抽選「${entry.title}」の履歴を削除しますか？`)) return;
    setLotteryHistory((prev) => {
      const next = [...prev]; next.splice(index,1); try{localStorage.setItem("lotteryHistory",JSON.stringify(next));}catch(e){}
      return next;
    });
    socket.emit("admin_delete_lottery_history", { title: entry.title, index });
  };
  const handleClearLotteryHistory = () => { if (!window.confirm("抽選履歴をすべて削除しますか？")) return; setLotteryHistory([]); try { localStorage.removeItem("lotteryHistory"); } catch (e) {}; socket.emit("admin_clear_lottery_history"); };

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
        <AdminScreen
          lotteryTitle={lotteryTitle}
          drawCount={drawCount}
          minMatches={minMatches}
          minLoginHours={minLoginHours}
          drawResult={drawResult}
          lotteryHistory={lotteryHistory}
          activeMatches={activeMatches}
          usersList={usersList}
          autoLogoutHours={autoLogoutHours}
          matchEnabled={matchEnabled}
          handleToggleMatch={handleToggleMatch}
          handleDrawLots={handleDrawLots}
          handleAdminLogoutAll={handleAdminLogoutAll}
          handleUpdateAutoLogout={handleUpdateAutoLogout}
          handleLogoutUser={handleLogoutUser}
          handleAdminReportWin={handleAdminReportWin}
          handleAdminReportBothLose={handleAdminReportBothLose}
          handleDeleteLotteryEntry={handleDeleteLotteryEntry}
          handleClearLotteryHistory={handleClearLotteryHistory}
          handleAdminLogout={handleAdminLogout}
          setLotteryTitle={setLotteryTitle}
        />
      ) : opponent ? (
        <BattleScreen opponent={opponent} deskNum={deskNum} handleWinReport={handleWinReport} />
      ) : (
        <MenuScreen
          user={user}
          searching={searching}
          matchEnabled={matchEnabled}
          handleFindOpponent={handleFindOpponent}
          handleCancelSearch={handleCancelSearch}
          history={history}
          handleLogout={handleLogout}
          lotteryList={lotteryList}
          showLottery={showLottery}
          setShowLottery={setShowLottery}
          lotteryWinnerTitles={lotteryWinnerTitles}
        />
      )}
    </div>
  );
}

export default App;
