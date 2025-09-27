body, html {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: Arial, sans-serif;
  background-color: #fff;
}

.app {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.header {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  font-weight: bold;
  font-size: 20px;
  background-color: #fff;
  padding: 10px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  z-index: 100;
}

.header .wins {
  font-size: 14px;
  margin-top: 2px;
}

.content {
  margin-top: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.login-screen, .menu-screen, .battle-screen, .admin-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

button {
  padding: 12px 30px;
  font-size: 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  color: #fff;
  background-color: blue;
}

button:hover {
  opacity: 0.9;
}

.match-disabled {
  color: red;
  font-weight: bold;
}

.history-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: #fff;
  border-radius: 10px;
  padding: 20px;
  width: 360px;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 200;
}

.history-modal h3 {
  margin-bottom: 12px;
}

.history-modal ul {
  list-style: none;
  padding: 0;
  margin: 0 0 10px 0;
}

.history-modal li {
  margin-bottom: 6px;
  font-size: 14px;
}

.history-modal button {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  background-color: #f44336;
  color: #fff;
  cursor: pointer;
}

.history-modal button:hover {
  background-color: #d32f2f;
}

.admin-screen {
  width: 400px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  border: 2px solid #2196F3;
  border-radius: 10px;
  padding: 15px;
  background-color: #e3f2fd;
}

.admin-screen h3 {
  margin-bottom: 10px;
}

.admin-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.admin-section input[type="number"] {
  padding: 6px;
  width: 80px;
  border-radius: 5px;
  border: 1px solid #ccc;
  text-align: center;
}

.admin-section ul {
  list-style: none;
  padding: 0;
  margin: 5px 0 0 0;
  width: 100%;
}

.admin-section li {
  font-size: 14px;
  margin-bottom: 4px;
}

/* battle-screen / menu-screen 個別調整 */
.menu-screen button, .battle-screen button {
  width: 220px;
  text-align: center;
}

.app {
  background-color: white;
  text-align: center;
  font-family: sans-serif;
}

.header {
  font-weight: bold;
  margin-top: 20px;
}

.wins {
  font-size: 0.8em;
  display: block;
}

button {
  background-color: blue;
  color: white;
  padding: 10px 20px;
  margin: 10px;
  border: none;
  cursor: pointer;
  font-size: 1em;
}

button:hover {
  opacity: 0.8;
}

.menu-screen, .battle-screen, .admin-screen, .login-screen {
  margin-top: 50px;
}

.history-modal {
  position: fixed;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: #f9f9f9;
  border: 1px solid #ccc;
  padding: 20px;
}
