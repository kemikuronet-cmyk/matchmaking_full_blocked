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
  // 認証状態
  // ===============================
  const [userName, setUserName] = useState("");
  const [loggedInUser, setLoggedInUser] = useState(null);

  const [adminId, setAdminId] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // ===============================
  // 画面状態
  // ===============================
  const [screen, setScreen] = useState("login");

  // ===============================
  // マッチング / 卓状態
  // ===============================
  const [tables, setTables] = useState([]);
  const [history, setHistory] = useState([]);
  const [lotteryWinners, setLotteryWinners] = useState([]);

  const isConnectedRef = useRef(false);

  // ===============================
  // ユーザーログイン
  // ===============================
  const handleUserLogin = () => {
    if (!userName.trim()) return;

    console.log("🔵 ユーザーログイン:", userName);

    socket.emit("user:login", userName, (res) => {
      console.log("user:login result:", res);

      if (res?.success) {
        setLoggedInUser(userName);
        setScreen("menu");
      }
    });
  };

  // ===============================
  // 管理者ログイン
  // ===============================
  const handleAdminLogin = () => {
    if (!adminId.trim() || !adminPass.trim()) return;

    console.log("🟡 管理者ログイン:", adminId);

    socket.emit(
      "admin:login",
      { id: adminId, pass: adminPass },
      (res) => {
        console.log("admin:login result:", res);

        if (res?.success) {
          setIsAdmin(true);
          setScreen("admin");
        }
      }
    );
  };

  // ===============================
  // マッチング参加
  // ===============================
  const handleEnterMatch = () => {
    if (!loggedInUser) return;

    socket.emit("match:enter", loggedInUser, (res) => {
      console.log("match:enter result:", res);
    });
  };

  // ===============================
  // 対戦終了報告
  // ===============================
  const handleReportResult = (tableId, winner) => {
    socket.emit("match:reportResult", { tableId, winner });
  };

  // ===============================
  // 抽選開始
  // ===============================
  const handleLottery = () => {
    socket.emit("admin:lottery");
  };

  // ===============================
  // ソケット受信
  // ===============================
  useEffect(() => {
    if (isConnectedRef.current) return;
    isConnectedRef.current = true;

    console.log("🟢 Socket 接続開始");

    socket.on("connect", () => {
      console.log("🟢 connected:", socket.id);
    });

    socket.on("tables:update", (data) => {
      console.log("📦 tables:update", data);
      setTables(data);
    });

    socket.on("history:update", (data) => {
      console.log("📦 history:update", data);
      setHistory(data);
    });

    socket.on("lottery:update", (data) => {
      console.log("📦 lottery:update", data);
      setLotteryWinners(data);
    });

    socket.on("disconnect", () => {
      console.log("🔴 disconnected");
    });

    return () => {
      socket.off("tables:update");
      socket.off("history:update");
      socket.off("lottery:update");
    };
  }, []);

  // ===============================
  // UI : 背景（本番対応 import 方式）
  // ===============================
  const appStyle = {
    minHeight: "100vh",
    backgroundImage: `url(${bgImage})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  };

  // ==========================================================
  // 画面 ① ユーザーログイン
  // ==========================================================
  if (screen === "login")
    return (
      <div className="login-screen" style={appStyle}>
        <div className="admin-login-topright">
          <input
            type="text"
            value={adminId}
            placeholder="Admin ID"
            onChange={(e) => setAdminId(e.target.value)}
          />
          <input
            type="password"
            value={adminPass}
            placeholder="Password"
            onChange={(e) => setAdminPass(e.target.value)}
          />
          <button className="admin-btn" onClick={handleAdminLogin}>
            管理者
          </button>
        </div>

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
  // 画面 ② ユーザーメニュー
  // ==========================================================
  if (screen === "menu")
    return (
      <div className="menu-screen" style={appStyle}>
        <div className="header">ようこそ {loggedInUser} さん</div>

        <button className="main-btn" onClick={handleEnterMatch}>
          マッチング参加
        </button>

        <div className="history-list">
          <h3>対戦履歴</h3>

          <table>
            <thead>
              <tr>
                <th>卓ID</th>
                <th>勝者</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.tableId}</td>
                  <td className={h.result === "win" ? "win" : "lose"}>
                    {h.winner}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          className="main-btn"
          onClick={() => {
            setLoggedInUser(null);
            setScreen("login");
          }}
        >
          ログアウト
        </button>
      </div>
    );

  // ==========================================================
  // 画面 ③ 管理者画面
  // ==========================================================
  if (screen === "admin")
    return (
      <div className="admin-screen" style={appStyle}>
        <div className="header">管理者メニュー</div>

        <div className="admin-section">
          <h3>対戦卓一覧</h3>

          {tables.map((table) => (
            <div key={table.id} className="battle-screen">
              <div>卓ID: {table.id}</div>
              <div>
                {table.players?.join(" vs ")}
              </div>

              <button
                className="admin-btn"
                onClick={() => handleReportResult(table.id, table.players[0])}
              >
                左側勝利
              </button>

              <button
                className="admin-btn"
                onClick={() => handleReportResult(table.id, table.players[1])}
              >
                右側勝利
              </button>
            </div>
          ))}
        </div>

        <div className="admin-section">
          <h3>抽選機能</h3>

          <button className="admin-btn" onClick={handleLottery}>
            抽選を実行
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
            setIsAdmin(false);
            setScreen("login");
          }}
        >
          ログアウト
        </button>
      </div>
    );

  // fallback
  return null;
}
