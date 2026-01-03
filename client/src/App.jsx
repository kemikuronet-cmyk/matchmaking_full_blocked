import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import bgImage from "./images/background.jpg";

const SERVER_URL = "/";

const socket = io(SERVER_URL, {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 3000,
});

export default function App() {
  // ===============================
  // 状態
  // ===============================
  const [userName, setUserName] = useState("");
  const [loggedInUser, setLoggedInUser] = useState(null);

  const [adminPassword, setAdminPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [screen, setScreen] = useState("login");

  const [tables, setTables] = useState([]);
  const [history, setHistory] = useState([]);
  const [lotteryWinners, setLotteryWinners] = useState([]);

  const connectedRef = useRef(false);

  // ===============================
  // ユーザーログイン
  // ===============================
  const handleUserLogin = () => {
    if (!userName.trim()) return;

    console.log("🟢 ユーザーログイン要求:", userName);

    socket.emit("loginUser", { name: userName }, (res) => {
      console.log("loginUser result:", res);

      if (res?.success) {
        setLoggedInUser(userName);
        setScreen("menu");
      }
    });
  };

  // ===============================
  // 管理者ログイン（右上フォーム）
  // ===============================
  const handleAdminLogin = () => {
    if (!adminPassword.trim()) return;

    console.log("🟡 管理者ログイン");

    socket.emit("adminLogin", { pass: adminPassword }, (res) => {
      console.log("adminLogin result:", res);

      if (res?.success) {
        setIsAdmin(true);
        setScreen("admin");
      }
    });
  };

  // ===============================
  // マッチング参加
  // ===============================
  const handleEnterMatch = () => {
    if (!loggedInUser) return;

    socket.emit("enterMatch", loggedInUser);
  };

  // ===============================
  // 勝敗報告
  // ===============================
  const handleReportResult = (tableId, winner) => {
    socket.emit("reportResult", { tableId, winner });
  };

  // ===============================
  // 抽選
  // ===============================
  const handleLottery = () => {
    socket.emit("runLottery");
  };

  // ===============================
  // Socket 受信
  // ===============================
  useEffect(() => {
    if (connectedRef.current) return;
    connectedRef.current = true;

    socket.on("tablesUpdate", setTables);
    socket.on("historyUpdate", setHistory);
    socket.on("lotteryUpdate", setLotteryWinners);

    return () => {
      socket.off("tablesUpdate");
      socket.off("historyUpdate");
      socket.off("lotteryUpdate");
    };
  }, []);

  // ===============================
  // 背景適用
  // ===============================
  const appStyle = {
    minHeight: "100vh",
    backgroundImage: `url(${bgImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  };

  // ==========================================================
  // ① ログイン画面
  // ==========================================================
  if (screen === "login")
    return (
      <div className="login-screen" style={appStyle}>
        {/* 🔸 右上小型 管理者ログイン */}
        <div className="admin-login-topright">
          <input
            type="password"
            value={adminPassword}
            placeholder="管理者パスワード"
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button className="admin-btn" onClick={handleAdminLogin}>
            管理者
          </button>
        </div>

        {/* 🔹 中央 ユーザーログイン */}
        <div className="user-login-center">
          <h2>ユーザーログイン</h2>

          <input
            type="text"
            value={userName}
            placeholder="ユーザー名"
            onChange={(e) => setUserName(e.target.value)}
          />

          <button className="main-btn" onClick={handleUserLogin}>
            ログイン
          </button>
        </div>
      </div>
    );

  // ==========================================================
  // ② ユーザーメニュー
  // ==========================================================
  if (screen === "menu")
    return (
      <div className="menu-screen" style={appStyle}>
        <div className="header">{loggedInUser} さん</div>

        <button className="main-btn" onClick={handleEnterMatch}>
          マッチング参加
        </button>

        <div className="history-list">
          <h3>対戦履歴</h3>

          <table>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.tableId}</td>
                  <td>{h.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          className="main-btn"
          onClick={() => {
            setScreen("login");
            setLoggedInUser(null);
          }}
        >
          ログアウト
        </button>
      </div>
    );

  // ==========================================================
  // ③ 管理者画面
  // ==========================================================
  if (screen === "admin")
    return (
      <div className="admin-screen" style={appStyle}>
        <div className="header">管理者メニュー</div>

        <div className="admin-section">
          <h3>対戦卓</h3>

          {tables.map((t) => (
            <div key={t.id} className="battle-screen">
              <div>{t.players?.join(" vs ")}</div>

              <button
                className="admin-btn"
                onClick={() => handleReportResult(t.id, t.players[0])}
              >
                左側勝利
              </button>

              <button
                className="admin-btn"
                onClick={() => handleReportResult(t.id, t.players[1])}
              >
                右側勝利
              </button>
            </div>
          ))}
        </div>

        <div className="admin-section">
          <h3>抽選</h3>

          <button className="admin-btn" onClick={handleLottery}>
            抽選実行
          </button>

          <div className="lottery-list">
            {lotteryWinners.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>

        <button
          className="main-btn"
          onClick={() => {
            setScreen("login");
            setIsAdmin(false);
          }}
        >
          ログアウト
        </button>
      </div>
    );

  return null;
}
