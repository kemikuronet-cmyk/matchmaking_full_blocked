import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = "/";

export default function App() {
  const socketRef = useRef(null);

  const [sessionId, setSessionId] = useState(
    localStorage.getItem("sessionId") || crypto.randomUUID()
  );
  const [name, setName] = useState(localStorage.getItem("name") || "");

  const [loggedIn, setLoggedIn] = useState(false);
  const [matchEnabled, setMatchEnabled] = useState(false);

  const [deskNum, setDeskNum] = useState(null);
  const [opponent, setOpponent] = useState(null);

  const [history, setHistory] = useState([]);
  const [lotteryList, setLotteryList] = useState([]);

  // ===== Admin =====
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPass, setAdminPass] = useState("");

  const [activeMatches, setActiveMatches] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);

  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);

  // ==================================================
  // Socket 初期化
  // ==================================================
  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    // ===== login OK =====
    socket.on("login_ok", (data) => {
      setLoggedIn(true);
      setMatchEnabled(data.matchEnabled);

      // 再接続復元
      setDeskNum(data.deskNum ?? null);
      setOpponent(data.opponent ?? null);

      setHistory(data.history || []);
      setLotteryList(data.lotteryList || []);
    });

    // ===== マッチング結果 =====
    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent.name);
      setDeskNum(deskNum);
    });

    // ===== 勝利処理完了 → メニューへ =====
    socket.on("return_to_menu_battle", () => {
      setDeskNum(null);
      setOpponent(null);
    });

    // ===== マッチング ON/OFF =====
    socket.on("match_status_update", ({ enabled }) => {
      setMatchEnabled(enabled);
    });

    // ===== 抽選当選者更新 =====
    socket.on("update_lottery_list", ({ list }) => {
      setLotteryList(list || []);
    });

    // ===== Admin =====
    socket.on("admin_ok", () => {
      setIsAdmin(true);
    });

    socket.on("admin_fail", () => {
      alert("管理者パスワードが違います");
    });

    socket.on("admin_active_matches", (desks) => {
      setActiveMatches(desks || []);
    });

    socket.on("admin_lottery_history", (hist) => {
      setLotteryHistory(hist || []);
    });

    socket.on("admin_lottery_result", (record) => {
      alert(`抽選完了: ${record.title}`);
    });

    return () => socket.disconnect();
  }, []);

  // ==================================================
  // ログイン
  // ==================================================
  const handleLogin = () => {
    if (!name) return alert("名前を入力してください");

    localStorage.setItem("name", name);
    localStorage.setItem("sessionId", sessionId);

    socketRef.current.emit("login", {
      name,
      sessionId,
    });
  };

  // ==================================================
  // 対戦相手を探す
  // ==================================================
  const findOpponent = () => {
    socketRef.current.emit("find_opponent");
  };

  // ==================================================
  // 勝利報告
  // ==================================================
  const reportWin = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socketRef.current.emit("report_win_request");
  };

  // ==================================================
  // 管理者ログイン
  // ==================================================
  const adminLogin = () => {
    socketRef.current.emit("admin_login", {
      password: adminPass,
    });
  };

  const enableMatch = () => {
    socketRef.current.emit("admin_enable_matching");
  };

  const disableMatch = () => {
    socketRef.current.emit("admin_disable_matching");
  };

  // ==================================================
  // 抽選実行
  // ==================================================
  const runLottery = () => {
    socketRef.current.emit("admin_run_lottery", {
      title: lotteryTitle || "抽選",
      count: Number(lotteryCount) || 1,
    });
  };

  // ==================================================
  // 未ログイン画面
  // ==================================================
  if (!loggedIn) {
    return (
      <div className="container center">
        <h2>ログイン</h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ユーザー名"
        />

        <button onClick={handleLogin}>ログイン</button>

        {/* 右下固定の管理者ログイン */}
        <div className="admin-login-box">
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPass}
            onChange={(e) => setAdminPass(e.target.value)}
          />
          <button onClick={adminLogin}>管理者ログイン</button>
        </div>
      </div>
    );
  }

  // ==================================================
  // 対戦中画面
  // ==================================================
  if (deskNum) {
    return (
      <div className="container center">
        <h2>対戦中</h2>

        <p>卓番号：{deskNum}</p>
        <p>対戦相手：{opponent}</p>

        <button onClick={reportWin}>勝利報告</button>
      </div>
    );
  }

  // ==================================================
  // ユーザーメニュー
  // ==================================================
  return (
    <div className="container center">
      <h2>ユーザーメニュー</h2>

      <p>名前：{name}</p>

      {matchEnabled ? (
        <button onClick={findOpponent}>対戦相手を探す</button>
      ) : (
        <p>マッチング時間外です</p>
      )}

      <h3>対戦履歴</h3>
      <ul>
        {history.map((h, i) => (
          <li key={i}>
            {h.opponent}：{h.result}
          </li>
        ))}
      </ul>

      <h3>抽選当選者</h3>
      <ul>
        {lotteryList.map((w, i) => (
          <li key={i}>{w.name}</li>
        ))}
      </ul>

      {/* ===== 管理者メニュー ===== */}
      {isAdmin && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <h3>マッチング操作</h3>
          <button onClick={enableMatch}>開始</button>
          <button onClick={disableMatch}>停止</button>

          <h3>アクティブ対戦卓</h3>
          <ul>
            {activeMatches.map((d) => (
              <li key={d.deskNum}>
                卓{d.deskNum}：{d.player1} vs {d.player2}
              </li>
            ))}
          </ul>

          <h3>抽選</h3>

          <input
            placeholder="抽選タイトル"
            value={lotteryTitle}
            onChange={(e) => setLotteryTitle(e.target.value)}
          />

          <input
            type="number"
            min="1"
            value={lotteryCount}
            onChange={(e) => setLotteryCount(e.target.value)}
          />

          <button onClick={runLottery}>抽選実行</button>

          <h3>抽選履歴</h3>
          <ul>
            {lotteryHistory.map((r, i) => (
              <li key={i}>
                {r.title}（{new Date(r.time).toLocaleString()}）
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
