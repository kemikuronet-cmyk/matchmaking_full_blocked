import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("/");

function App() {
  // -------------------- state --------------------
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [desks, setDesks] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------- socket useEffect --------------------
  useEffect(() => {
    const onLoginOk = (userData) => { setUser(userData); setLoggedIn(true); };
    const onMatched = (data) => { setOpponent(data.opponent); setDeskNum(data.deskNum); };
    const onReturnToMenu = () => { setOpponent(null); setDeskNum(null); };
    const onHistory = (hist) => { setHistory(hist); };
    const onLotteryWinner = (data) => { setLotteryResults(data); };
    const onUpdateLotteryList = (data) => { setLotteryResults(data); };
    const onAdminOk = () => { setAdminMode(true); setLoggedIn(false); };
    const onAdminFail = () => { alert("管理者パスワードが違います"); };

    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("history", onHistory);
    socket.on("lottery_winner", onLotteryWinner);
    socket.on("update_lottery_list", onUpdateLotteryList);
    socket.on("admin_ok", onAdminOk);
    socket.on("admin_fail", onAdminFail);

    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("history", onHistory);
      socket.off("lottery_winner", onLotteryWinner);
      socket.off("update_lottery_list", onUpdateLotteryList);
      socket.off("admin_ok", onAdminOk);
      socket.off("admin_fail", onAdminFail);

      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      if (reconnectIntervalRef.current) { clearInterval(reconnectIntervalRef.current); reconnectIntervalRef.current = null; }
    };
  }, []);

  // -------------------- ハンドラ --------------------
  const handleLogin = () => {
    const trimmed = name.trim();
    if (!trimmed) return alert("ユーザー名を入力してください");
    socket.emit("login", { name: trimmed });
  };

  const handleAdminLogin = () => { 
    if (!adminPassword) return; 
    socket.emit("admin_login", { password: adminPassword }); 
  };

  const handleLogout = () => { 
    if (!window.confirm("ログアウトしますか？")) return; 
    setUser(null); setLoggedIn(false); setAdminMode(false); setOpponent(null); setDeskNum(null); setHistory([]); setName(""); 
  };

  const handleFindOpponent = () => { setSearching(true); socket.emit("find_opponent"); };
  const handleCancelSearch = () => { setSearching(false); socket.emit("cancel_find"); };
  const handleWinReport = () => { if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return; socket.emit("report_win_request"); };

  const handleFetchDesks = () => { socket.emit("admin_fetch_desks"); };
  const handleFetchUsers = () => { socket.emit("admin_fetch_users"); };

  const handleAdminWin = (deskNum) => { 
    if (!window.confirm(`卓 ${deskNum} の勝者を登録しますか？`)) return;
    socket.emit("admin_report_win", { deskNum });
  };

  const handleForceClearDesk = (deskNum) => { 
    if (!window.confirm(`卓 ${deskNum} を削除しますか？`)) return;
    socket.emit("admin_force_clear_desk", { deskNum });
  };

  const handleRunLottery = () => { 
    if (!lotteryTitle) return alert("抽選タイトルを入力してください");
    socket.emit("admin_draw_lottery", { title: lotteryTitle, count: lotteryCount });
  };

  // -------------------- JSX --------------------
  return (
    <div className="app">
      {/* 管理者ログイントップ右上 */}
      {!adminMode && !loggedIn && (
        <div className="admin-login-topright">
          <input type="password" placeholder="管理者パスワード" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      )}

      {/* ユーザーログイン画面 */}
      {!loggedIn && !adminMode && (
        <div className="login-screen">
          <h2>ユーザーログイン</h2>
          <input type="text" placeholder="ユーザー名" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="main-container">
          <div className="admin-panel">
            <h2>管理者メニュー</h2>

            <div className="admin-controls">
              <button className="main-btn" onClick={handleLogout}>ログアウト</button>
              <button className="main-btn" onClick={handleFetchDesks}>卓一覧更新</button>
              <button className="main-btn" onClick={handleFetchUsers}>ユーザー一覧更新</button>
            </div>

            {/* 対戦卓一覧 */}
            <div className="desk-section">
              <h3>対戦卓一覧</h3>
              {desks.length === 0 ? (
                <p>現在、稼働中の卓はありません</p>
              ) : (
                <ul>
                  {desks.map((d,i)=>(
                    <li key={i}>
                      <strong>卓 {d.deskNum}</strong>: {d.players?.map(p=>p.name).join(" vs ")}
                      <button className="admin-btn" onClick={()=>handleAdminWin(d.deskNum)}>勝者登録</button>
                      <button className="admin-btn" onClick={()=>handleForceClearDesk(d.deskNum)}>卓削除</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 抽選 */}
            <div className="lottery-admin-section">
              <h3>抽選機能</h3>
              <input type="text" placeholder="抽選タイトル" value={lotteryTitle} onChange={(e)=>setLotteryTitle(e.target.value)} />
              <input type="number" placeholder="当選人数" value={lotteryCount} onChange={(e)=>setLotteryCount(Number(e.target.value))} />
              <button className="main-btn" onClick={handleRunLottery}>抽選実行</button>

              <div className="lottery-history">
                <h4>抽選履歴</h4>
                {lotteryResults.length === 0 ? <p>抽選履歴なし</p> : (
                  <ul>
                    {lotteryResults.map((lot,idx)=>(
                      <li key={idx}>
                        <strong>{lot.title}</strong>
                        <ul>{lot.winners?.map((w,i)=><li key={i}>{w.name}</li>)}</ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ユーザー画面 */}
      {loggedIn && user && (
        <div className="main-container">
          <h2>ようこそ {user.name} さん</h2>
          <p>勝ち: {history.filter(h=>h.result==="WIN").length}</p>
          <p>負け: {history.filter(h=>h.result==="LOSE").length}</p>
          <p>対戦数: {history.length}</p>

          {!opponent && (
            <div>
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="main-btn" onClick={handleCancelSearch}>キャンセル</button>
              )}
            </div>
          )}

          {opponent && (
            <div>
              <h3>対戦相手: {opponent.name}</h3>
              <p>卓番号: {deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          {/* 対戦履歴 */}
          <div className="history-section">
            <h3>対戦履歴</h3>
            {history.length===0 ? <p>対戦履歴なし</p> : (
              <ul className="history-list">
                {history.map((h,i)=><li key={i}><strong>{h.opponent}</strong>: {h.result}</li>)}
              </ul>
            )}
          </div>

          {/* 抽選結果 */}
          <div className="lottery-user-section">
            <h3>抽選結果</h3>
            {lotteryHistory.length===0 ? <p>抽選履歴なし</p> : (
              <ul className="lottery-list">
                {lotteryHistory.map((entry,idx)=>(
                  <li key={idx}><strong>{entry.title}</strong>: {entry.winners?.map(w=>w.name).join(", ")}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
